import {
  get,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  update,
  type DataSnapshot,
  type Database,
} from 'firebase/database'
import type { RoomHandlers, RoomLink } from '../game/online'
import {
  MAX_PLAYERS,
  NAME_MAX,
  NAME_MIN,
  generateRoomCode,
  isRoomCode,
  isValidName,
  normalizeRoomCode,
  slotsToTry,
  type NetState,
  type RoomMeta,
  type RoomPlayer,
} from '../sim/sync'
import { createRaceChannel } from './race'

const ROOMS = 'taipeiBike/rooms'
const CREATE_ATTEMPTS = 10
/** 重新加入失敗後的重試間隔（毫秒），每次加倍直到上限 */
const REJOIN_RETRY_MIN = 500
const REJOIN_RETRY_MAX = 10_000

const MESSAGES = {
  ROOM_NOT_FOUND: '找不到這個房間',
  ROOM_FULL: `房間已滿（${MAX_PLAYERS} 人）`,
  BAD_NAME: `暱稱必須是 ${NAME_MIN}–${NAME_MAX} 字`,
  NO_FREE_CODE: '暫時無法產生房號，請再試一次',
} as const

export type RoomErrorCode = keyof typeof MESSAGES

export class RoomError extends Error {
  private constructor(readonly code: RoomErrorCode) {
    super(MESSAGES[code])
    this.name = 'RoomError'
  }

  static of(code: RoomErrorCode): RoomError {
    return new RoomError(code)
  }
}

export interface RoomRepository {
  /** 建立房間並加入，建立者是第一位玩家 */
  createRoom(uid: string, name: string): Promise<RoomLink>
  /** code 不分大小寫、可含前後空白 */
  joinRoom(code: string, uid: string, name: string): Promise<RoomLink>
}

function randomUint32(count: number): Uint32Array {
  return crypto.getRandomValues(new Uint32Array(count))
}

function isPermissionDenied(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === 'PERMISSION_DENIED'
}

function readState(snap: DataSnapshot): NetState {
  const v = snap.val() as NetState
  return { x: v.x, z: v.z, h: v.h, mode: v.mode, cx: v.cx, cz: v.cz, ch: v.ch, loc: v.loc }
}

export function createRoomRepository(db: Database): RoomRepository {
  const roomPath = (code: string) => `${ROOMS}/${code}`
  const playerRef = (code: string, uid: string) => ref(db, `${roomPath(code)}/players/${uid}`)
  const stateRef = (code: string, uid: string) => ref(db, `${roomPath(code)}/states/${uid}`)

  const roomRef = (code: string) => ref(db, roomPath(code))

  /** 斷線時移除的資料。斷線時的寫入每個路徑各自用斷線前的資料檢查規則，位子無法一起移除；主人沒有玩家資料的位子，規則允許別人接手 */
  const dropUpdate = (uid: string) => ({
    [`players/${uid}`]: null,
    [`states/${uid}`]: null,
  })

  /** 主動離開：規則要求位子、玩家資料、狀態在同一筆更新移除 */
  const leaveUpdate = (slot: string, uid: string) => ({ ...dropUpdate(uid), [`slots/${slot}`]: null })

  /** 先登記斷線時的移除，再一次寫入位子與玩家資料。回傳 false 表示位子已被別人占走 */
  async function tryEnter(code: string, slot: string, uid: string, name: string): Promise<boolean> {
    const room = roomRef(code)
    try {
      await onDisconnect(room).update(dropUpdate(uid))
      await update(room, { [`slots/${slot}`]: uid, [`players/${uid}`]: { name, joinedAt: serverTimestamp() } })
      return true
    } catch (error) {
      await onDisconnect(room).cancel()
      if (isPermissionDenied(error)) return false
      throw error
    }
  }

  async function leave(code: string, slot: string, uid: string): Promise<void> {
    const room = roomRef(code)
    await onDisconnect(room).cancel()
    await update(room, leaveUpdate(slot, uid))
  }

  /** 依序嘗試位子直到占到一個；signal 中止後不再寫入，已寫入的會移除 */
  async function enter(code: string, uid: string, name: string, signal?: AbortSignal): Promise<void> {
    const [slotsSnap, playersSnap] = await Promise.all([
      get(ref(db, `${roomPath(code)}/slots`)),
      get(ref(db, `${roomPath(code)}/players`)),
    ])
    const slots = (slotsSnap.val() as Record<string, string> | null) ?? {}
    const players = (playersSnap.val() as Record<string, RoomPlayer> | null) ?? {}
    for (const slot of slotsToTry(slots, uid, players)) {
      signal?.throwIfAborted()
      if (!(await tryEnter(code, slot, uid, name))) continue
      if (signal?.aborted) {
        await leave(code, slot, uid)
        signal.throwIfAborted()
      }
      return
    }
    throw RoomError.of('ROOM_FULL')
  }

  function link(code: string, uid: string, name: string, meta: RoomMeta): RoomLink {
    return {
      code,
      uid,
      meta,
      race: createRaceChannel(db, roomPath(code), uid),
      send: (state) => set(stateRef(code, uid), { ...state, t: serverTimestamp() }),
      watch: (handlers, onError) => watchRoom(code, uid, name, handlers, onError),
    }
  }

  function watchRoom(code: string, uid: string, name: string, handlers: RoomHandlers, onError: (error: Error) => void): () => void {
    const states = ref(db, `${roomPath(code)}/states`)
    const pushState = (snap: DataSnapshot) => {
      if (snap.key) handlers.state(snap.key, readState(snap))
    }

    // 斷線期間伺服器已執行 onDisconnect 移除自己，連回來後重新加入；失敗時間隔加倍重試
    const aborter = new AbortController()
    let connected = false
    let present = true
    let entering = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let retryDelay = REJOIN_RETRY_MIN
    const rejoinIfGone = () => {
      if (aborter.signal.aborted || !connected || present || entering || retryTimer !== undefined) return
      entering = true
      enter(code, uid, name, aborter.signal)
        .then(() => {
          retryDelay = REJOIN_RETRY_MIN
        })
        .catch((error: unknown) => {
          if (aborter.signal.aborted) return
          onError(error instanceof Error ? error : new Error(String(error)))
          retryTimer = setTimeout(() => {
            retryTimer = undefined
            rejoinIfGone()
          }, retryDelay)
          retryDelay = Math.min(retryDelay * 2, REJOIN_RETRY_MAX)
        })
        .finally(() => {
          entering = false
        })
    }

    const stops = [
      onValue(ref(db, '.info/serverTimeOffset'), (snap) => handlers.serverOffset((snap.val() as number | null) ?? 0)),
      onValue(
        ref(db, `${roomPath(code)}/players`),
        (snap) => handlers.players((snap.val() as Record<string, RoomPlayer> | null) ?? {}),
        onError,
      ),
      onChildAdded(states, pushState, onError),
      onChildChanged(states, pushState, onError),
      onChildRemoved(
        states,
        (snap) => {
          if (snap.key) handlers.state(snap.key, null)
        },
        onError,
      ),
      onValue(ref(db, '.info/connected'), (snap) => {
        connected = snap.val() === true
        rejoinIfGone()
      }),
      onValue(
        playerRef(code, uid),
        (snap) => {
          present = snap.exists()
          rejoinIfGone()
        },
        onError,
      ),
    ]
    return () => {
      aborter.abort()
      clearTimeout(retryTimer)
      stops.forEach((stop) => stop())
    }
  }

  async function createRoom(uid: string, rawName: string): Promise<RoomLink> {
    if (!isValidName(rawName)) throw RoomError.of('BAD_NAME')
    const name = rawName.trim()
    for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
      const code = generateRoomCode(randomUint32(4))
      const metaRef = ref(db, `${roomPath(code)}/meta`)
      const seed = randomUint32(1)[0]!
      const { committed } = await runTransaction(
        metaRef,
        (current: RoomMeta | null) => (current === null ? { seed, creatorUid: uid, createdAt: serverTimestamp() } : undefined),
        { applyLocally: false },
      )
      if (!committed) continue
      try {
        const meta = (await get(metaRef)).val() as RoomMeta
        await enter(code, uid, name)
        return link(code, uid, name, meta)
      } catch (error) {
        await remove(metaRef).catch(() => undefined)
        throw error
      }
    }
    throw RoomError.of('NO_FREE_CODE')
  }

  async function joinRoom(rawCode: string, uid: string, rawName: string): Promise<RoomLink> {
    if (!isValidName(rawName)) throw RoomError.of('BAD_NAME')
    const name = rawName.trim()
    const code = normalizeRoomCode(rawCode)
    if (!isRoomCode(code)) throw RoomError.of('ROOM_NOT_FOUND')
    const meta = (await get(ref(db, `${roomPath(code)}/meta`))).val() as RoomMeta | null
    if (!meta) throw RoomError.of('ROOM_NOT_FOUND')
    await enter(code, uid, name)
    return link(code, uid, name, meta)
  }

  return { createRoom, joinRoom }
}

import type { PlayerState } from './player'

/** 位置上傳最短間隔（毫秒），即每秒至多 10 次 */
export const SEND_INTERVAL = 100
/** 畫面上其他玩家比最新狀態落後的時間（毫秒） */
export const INTERP_DELAY = 100
/** 每位其他玩家保留的狀態筆數 */
export const INTERP_KEEP = 2
export const MAX_PLAYERS = 6
export const NAME_MIN = 2
export const NAME_MAX = 12

export const OUTDOOR = 'outdoor'
/** 大寫英數，去掉易混淆的 0 O 1 I */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_LENGTH = 4

export interface RoomMeta {
  seed: number
  creatorUid: string
  /** 伺服器時間（毫秒） */
  createdAt: number
}

export interface RoomPlayer {
  name: string
  /** 伺服器時間（毫秒） */
  joinedAt: number
}

/** loc：OUTDOOR 或住家 id；mode 為 bike 時 x/z/h 就是腳踏車的位置與朝向 */
export interface NetState {
  x: number
  z: number
  h: number
  mode: PlayerState['mode']
  cx: number
  cz: number
  ch: number
  loc: string
  /** 腳踏車車身傾角（rad，往右為正，倒地為 ±π/2）；沒騎車時為 0 */
  l: number
}

export interface RemoteSample extends NetState {
  /** 收到這筆狀態的本機時間（毫秒） */
  at: number
}

export interface Sender {
  tick(now: number): { sender: Sender; send: boolean }
}

export function createSender(lastSentAt = -Infinity): Sender {
  return {
    tick: (now) =>
      now - lastSentAt >= SEND_INTERVAL ? { sender: createSender(now), send: true } : { sender: createSender(lastSentAt), send: false },
  }
}

export function lerpAngle(a: number, b: number, u: number): number {
  let d = (b - a) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return a + d * u
}

export function blankNetState(): NetState {
  return { x: 0, z: 0, h: 0, mode: 'walk', cx: 0, cz: 0, ch: 0, loc: OUTDOOR, l: 0 }
}

function copyInto(src: NetState, out: NetState): void {
  out.x = src.x
  out.z = src.z
  out.h = src.h
  out.mode = src.mode
  out.cx = src.cx
  out.cz = src.cz
  out.ch = src.ch
  out.loc = src.loc
  out.l = src.l
}

/**
 * samples 依 at 遞增；把 renderNow − INTERP_DELAY 這個時間點的內插結果寫進 out。
 * 沒有任何狀態時回傳 false。out 由呼叫端重用，每幀呼叫不配置新物件。
 */
export function writeInterpolated(samples: readonly RemoteSample[], renderNow: number, out: NetState): boolean {
  const last = samples.at(-1)
  if (!last) return false
  const t = renderNow - INTERP_DELAY
  const first = samples[0]!
  if (t <= first.at) {
    copyInto(first, out)
    return true
  }
  for (let k = 1; k < samples.length; k++) {
    const a = samples[k - 1]!
    const b = samples[k]!
    if (t <= b.at) {
      const u = (t - a.at) / (b.at - a.at)
      out.x = a.x + (b.x - a.x) * u
      out.z = a.z + (b.z - a.z) * u
      out.h = lerpAngle(a.h, b.h, u)
      out.mode = b.mode
      out.cx = a.cx + (b.cx - a.cx) * u
      out.cz = a.cz + (b.cz - a.cz) * u
      out.ch = lerpAngle(a.ch, b.ch, u)
      out.loc = b.loc
      out.l = a.l + (b.l - a.l) * u
      return true
    }
  }
  copyInto(last, out)
  return true
}

export function interpolate(samples: readonly RemoteSample[], renderNow: number): NetState | null {
  const out = blankNetState()
  return writeInterpolated(samples, renderNow, out) ? out : null
}

/** 加入一筆新狀態，只保留最近 INTERP_KEEP 筆；回傳新陣列 */
export function pushSample(samples: readonly RemoteSample[], sample: RemoteSample): RemoteSample[] {
  return [...samples, sample].slice(-INTERP_KEEP)
}

export function toNetState(player: PlayerState): NetState {
  return {
    x: player.pos.x,
    z: player.pos.z,
    h: player.heading,
    mode: player.mode,
    cx: player.car.pos.x,
    cz: player.car.pos.z,
    ch: player.car.heading,
    loc: player.location.kind === 'home' ? player.location.homeId : OUTDOOR,
    l: player.mode === 'bike' && player.bike ? player.bike.lean : 0,
  }
}

export function sameNetState(a: NetState | null, b: NetState): boolean {
  return (
    a !== null &&
    a.x === b.x &&
    a.z === b.z &&
    a.h === b.h &&
    a.mode === b.mode &&
    a.cx === b.cx &&
    a.cz === b.cz &&
    a.ch === b.ch &&
    a.loc === b.loc &&
    a.l === b.l
  )
}

/** 連線時的世界時間（秒） */
export function worldTimeAt(serverNowMs: number, createdAtMs: number): number {
  return Math.max(0, (serverNowMs - createdAtMs) / 1000)
}

/** 長度以 UTF-16 計，與資料庫規則相同 */
export function isValidName(name: string): boolean {
  const { length } = name.trim()
  return length >= NAME_MIN && length <= NAME_MAX
}

/** 同一個地點（戶外或同一戶）才互相看得到 */
export function canSee(myLoc: string, otherLoc: string): boolean {
  return myLoc === otherLoc
}

export function hostOf(players: Record<string, { joinedAt: number }>): string | null {
  let host: string | null = null
  let earliest = Infinity
  for (const [uid, p] of Object.entries(players)) {
    if (p.joinedAt < earliest || (p.joinedAt === earliest && host !== null && uid < host)) {
      host = uid
      earliest = p.joinedAt
    }
  }
  return host
}

/** values 是隨機整數，每個字元用一個 */
export function generateRoomCode(values: ArrayLike<number>): string {
  return Array.from({ length: ROOM_CODE_LENGTH }, (_, k) => ROOM_CODE_ALPHABET[(values[k] ?? 0) % ROOM_CODE_ALPHABET.length]).join('')
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase()
}

export function isRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((ch) => ROOM_CODE_ALPHABET.includes(ch))
}

/** 房間的位子編號 '0'…'5'；占到位子才能加入，位子數就是人數上限 */
export const SLOT_IDS: readonly string[] = Array.from({ length: MAX_PLAYERS }, (_, k) => String(k))

/**
 * slots：位子編號 → uid。回傳 uid 已占的位子，否則依序回傳所有空位。
 * 有給 players 時，主人不在 players 裡的位子也算空位。
 */
export function slotsToTry(
  slots: Readonly<Record<string, string>>,
  uid: string,
  players?: Readonly<Record<string, unknown>>,
): string[] {
  const own = SLOT_IDS.find((id) => slots[id] === uid)
  if (own) return [own]
  return SLOT_IDS.filter((id) => {
    const owner = slots[id]
    return !owner || (players !== undefined && !(owner in players))
  })
}

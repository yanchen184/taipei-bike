import type { RaceSnapshot } from '../modes/race/link'
import type { PlayerState } from '../sim/player'
import type { AiNet, Progress } from '../sim/race'
import {
  OUTDOOR,
  SEND_INTERVAL,
  createSender,
  hostOf,
  interpolate,
  pushSample,
  sameNetState,
  toNetState,
  worldTimeAt,
  type NetState,
  type RemoteSample,
  type RoomMeta,
  type RoomPlayer,
} from '../sim/sync'
import type { Vec2 } from '../sim/types'

/** 房間資料變動時由連線層呼叫 */
export interface RoomHandlers {
  players(players: Readonly<Record<string, RoomPlayer>>): void
  /** state 為 null 表示該玩家的狀態被移除 */
  state(uid: string, state: NetState | null): void
  /** 伺服器時間 − 本機時間（毫秒） */
  serverOffset(ms: number): void
}

/** 房間內的比賽資料；完成時間由伺服器決定，送出的 fin 只表示已完成 */
export interface RaceChannel {
  /** 開始監聽，回傳停止函式 */
  watch(onChange: (snap: RaceSnapshot) => void, onError: (error: Error) => void): () => void
  /** 開新的一局；entrants：uid → 起跑格 */
  start(ai: number, cps: number, entrants: Record<string, number>): Promise<void>
  sendProgress(p: Progress): Promise<void>
  sendAi(ai: Readonly<Record<string, AiNet>>): Promise<void>
}

/** 已加入的房間；由 net 層實作 */
export interface RoomLink {
  readonly code: string
  readonly uid: string
  readonly meta: RoomMeta
  readonly race: RaceChannel
  send(state: NetState): Promise<void>
  /** 開始監聽房間，回傳停止監聽的函式 */
  watch(handlers: RoomHandlers, onError: (error: Error) => void): () => void
}

/** 畫面上要畫的其他玩家；loc 取最新一筆狀態 */
export interface RemoteEntry {
  uid: string
  name: string
  loc: string
}

export interface RosterEntry {
  uid: string
  name: string
  host: boolean
  me: boolean
}

const NO_SAMPLES: readonly RemoteSample[] = []

/** 房間內其他玩家的名單與最近狀態；React 只在名單、地點或錯誤變動時重繪 */
export class RoomStore {
  /** 畫面元件每幀寫入的補間結果，給測試掛鉤讀取 */
  readonly rendered = new Map<string, NetState>()
  private players: Readonly<Record<string, RoomPlayer>> = {}
  private readonly samples = new Map<string, readonly RemoteSample[]>()
  private remotes: readonly RemoteEntry[] = []
  private roster: readonly RosterEntry[] = []
  private error: string | null = null
  private readonly listeners = new Set<() => void>()

  constructor(private readonly selfUid: string) {}

  getRemotes = (): readonly RemoteEntry[] => this.remotes
  getRoster = (): readonly RosterEntry[] => this.roster
  getError = (): string | null => this.error

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  samplesOf(uid: string): readonly RemoteSample[] {
    return this.samples.get(uid) ?? NO_SAMPLES
  }

  setPlayers(players: Readonly<Record<string, RoomPlayer>>): void {
    this.players = players
    const host = hostOf(players)
    this.roster = Object.entries(players)
      .sort(([, a], [, b]) => a.joinedAt - b.joinedAt)
      .map(([uid, p]) => ({ uid, name: p.name, host: uid === host, me: uid === this.selfUid }))
    this.rebuildRemotes()
    this.emit()
  }

  pushState(uid: string, state: NetState, at: number): void {
    if (uid === this.selfUid) return
    const prev = this.samplesOf(uid)
    this.samples.set(uid, pushSample(prev, { ...state, at }))
    if (prev.at(-1)?.loc !== state.loc && this.rebuildRemotes()) this.emit()
  }

  removeState(uid: string): void {
    if (!this.samples.delete(uid)) return
    if (this.rebuildRemotes()) this.emit()
  }

  setError(message: string): void {
    this.error = message
    this.emit()
  }

  clearError(): void {
    if (this.error === null) return
    this.error = null
    this.emit()
  }

  /** 回傳清單是否有變 */
  private rebuildRemotes(): boolean {
    const next = Object.entries(this.players).flatMap(([uid, p]) => {
      const last = uid === this.selfUid ? undefined : this.samples.get(uid)?.at(-1)
      return last ? [{ uid, name: p.name, loc: last.loc }] : []
    })
    const same = next.length === this.remotes.length && next.every((r, k) => {
      const old = this.remotes[k]!
      return old.uid === r.uid && old.name === r.name && old.loc === r.loc
    })
    if (same) return false
    this.remotes = next
    return true
  }

  private emit(): void {
    this.listeners.forEach((l) => l())
  }
}

export interface SessionOptions {
  /** 單調遞增的毫秒時間，用來節流上傳與記錄收到狀態的時間 */
  now?: () => number
}

/** 上傳檢查的頻率比 SEND_INTERVAL 高，實際上傳次數由 Sender 限制 */
const SEND_POLL = SEND_INTERVAL / 4

/** 把一個已加入的房間接到遊戲：上傳自己的狀態、接收其他玩家 */
export class OnlineSession {
  readonly store: RoomStore
  private offset = 0
  private readonly now: () => number

  constructor(
    readonly link: RoomLink,
    options: SessionOptions = {},
  ) {
    this.store = new RoomStore(link.uid)
    this.now = options.now ?? (() => performance.now())
  }

  /** 伺服器時間（毫秒） */
  serverNow = (): number => Date.now() + this.offset

  worldTime = (): number => worldTimeAt(this.serverNow(), this.link.meta.createdAt)

  /** 其他玩家畫面上的腳踏車位置；不在戶外騎車時回傳 null */
  bikePositionOf = (uid: string): Vec2 | null => {
    const s = interpolate(this.store.samplesOf(uid), this.now())
    return s && s.mode === 'bike' && s.loc === OUTDOOR ? { x: s.x, z: s.z } : null
  }

  /** 開始同步，回傳停止函式；readPlayer 回傳自己目前的狀態 */
  start(readPlayer: () => PlayerState): () => void {
    const store = this.store
    const onError = (error: Error) => store.setError(error.message)

    // lastSent 只記伺服器確認寫入的狀態，failed 是寫入失敗、下次要重送的狀態；
    // 自己被移出房間時伺服器上的狀態也被移除，重新加入後 joins 遞增，之前送出的上傳結果不再算數
    let sender = createSender()
    let lastSent: NetState | null = null
    let failed: NetState | null = null
    let sending = false
    let present = true
    let joins = 0

    const unwatch = this.link.watch(
      {
        players: (players) => {
          const nowPresent = this.link.uid in players
          if (nowPresent && !present) {
            joins += 1
            lastSent = null
            failed = null
            store.clearError()
          }
          present = nowPresent
          store.setPlayers(players)
        },
        state: (uid, state) => (state ? store.pushState(uid, state, this.now()) : store.removeState(uid)),
        serverOffset: (ms) => {
          this.offset = ms
        },
      },
      onError,
    )

    const timer = setInterval(() => {
      if (sending || !present) return
      const state = failed ?? toNetState(readPlayer())
      if (sameNetState(lastSent, state)) return
      const tick = sender.tick(this.now())
      sender = tick.sender
      if (!tick.send) return
      const sentDuring = joins
      const stillJoined = () => present && sentDuring === joins
      sending = true
      this.link
        .send(state)
        .then(
          () => {
            if (!stillJoined()) return
            lastSent = state
            failed = null
            store.clearError()
          },
          // 移出房間後伺服器拒絕寫入狀態；重新加入後會重送目前狀態
          (error: Error) => {
            if (!stillJoined()) return
            failed = state
            onError(error)
          },
        )
        .finally(() => {
          sending = false
        })
    }, SEND_POLL)

    return () => {
      clearInterval(timer)
      unwatch()
    }
  }
}

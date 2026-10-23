import type { OnlineSession } from '../../game/online'
import { drawGrid, type AiNet, type BuildNet, type Progress, type RaceMeta } from '../../sim/race'

/** race 節點的內容；meta 為 null 表示還沒有比賽 */
export interface RaceSnapshot {
  meta: RaceMeta | null
  progress: Readonly<Record<string, Progress>>
  ai: Readonly<Record<string, AiNet>>
  /** 玩家 uid → 本局的組裝 */
  build: Readonly<Record<string, BuildNet>>
}

export interface RaceEntrant {
  id: string
  name: string
}

/** 比賽資料的讀寫；單人用 localRaceLink */
export interface RaceLink {
  readonly selfId: string
  /** 伺服器時間（毫秒） */
  serverNow(): number
  isHost(): boolean
  /** 房內玩家，依加入先後；單人時只有自己 */
  roster(): readonly RaceEntrant[]
  /** 房內玩家或房主可能變動時呼叫 listener，回傳取消函式 */
  subscribeRoster(listener: () => void): () => void
  /** 開始監聽：取得目前內容與之後每次變動都呼叫 onChange，回傳停止函式 */
  watch(onChange: (snap: RaceSnapshot) => void): () => void
  /** 房主開新的一局：局數加一，房內玩家依加入先後排起跑格；cpsOf：第 n 局的檢查點數 */
  start(ai: number, cpsOf: (n: number) => number): Promise<void>
  sendProgress(p: Progress): Promise<void>
  sendAi(ai: Record<string, AiNet>): Promise<void>
  /** 整備時寫入自己的組裝 */
  sendBuild(build: BuildNet): Promise<void>
  /** 單人按「出發」結束整備；連線的整備時間固定，不做事 */
  ready(): Promise<void>
}

export const EMPTY_RACE: RaceSnapshot = { meta: null, progress: {}, ai: {}, build: {} }

/** 連線用：房主是最早加入的玩家，起跑格由房主開局時隨機抽；讀寫錯誤顯示在房間面板 */
export function onlineRaceLink(session: OnlineSession): RaceLink {
  const { link, store } = session
  const roster = () => store.getRoster().map((e) => ({ id: e.uid, name: e.name }))
  return {
    selfId: link.uid,
    serverNow: session.serverNow,
    isHost: () => store.getRoster().some((e) => e.me && e.host),
    roster,
    subscribeRoster: store.subscribe,
    watch: (onChange) => link.race.watch(onChange, (error) => store.setError(error.message)),
    start: (ai, cpsOf) => link.race.start(ai, cpsOf, drawGrid(roster().map((e) => e.id), ai)),
    sendProgress: (p) => link.race.sendProgress(p),
    sendAi: (ai) => link.race.sendAi(ai),
    sendBuild: (build) => link.race.sendBuild(build),
    ready: async () => undefined,
  }
}

/** 單人用：資料放記憶體，自己就是房主；整備沒有時間限制，按「出發」才開始倒數；起跑格跟 AI 一起隨機抽 */
export function localRaceLink(selfId: string, name: string, now: () => number = Date.now, rand: () => number = Math.random): RaceLink {
  let snap = EMPTY_RACE
  const listeners = new Set<(snap: RaceSnapshot) => void>()
  const publish = (next: RaceSnapshot) => {
    snap = next
    listeners.forEach((l) => l(snap))
  }
  return {
    selfId,
    serverNow: now,
    isHost: () => true,
    roster: () => [{ id: selfId, name }],
    subscribeRoster: () => () => undefined,
    watch(onChange) {
      listeners.add(onChange)
      onChange(snap)
      return () => listeners.delete(onChange)
    },
    async start(ai, cpsOf) {
      const n = (snap.meta?.n ?? 0) + 1
      const meta: RaceMeta = { n, ai, cps: cpsOf(n), at: now(), entrants: drawGrid([selfId], ai, rand), ready: null }
      publish({ meta, progress: {}, ai: {}, build: {} })
    },
    async sendProgress(p) {
      publish({ ...snap, progress: { ...snap.progress, [selfId]: p } })
    },
    async sendAi(ai) {
      publish({ ...snap, ai })
    },
    async sendBuild(build) {
      publish({ ...snap, build: { ...snap.build, [selfId]: build } })
    },
    async ready() {
      if (snap.meta?.ready === null) publish({ ...snap, meta: { ...snap.meta, ready: now() } })
    },
  }
}

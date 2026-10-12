import type { AiNet, Progress, RaceMeta } from '../../sim/race'

/** race 節點的內容；meta 為 null 表示還沒有比賽 */
export interface RaceSnapshot {
  meta: RaceMeta | null
  progress: Readonly<Record<string, Progress>>
  ai: Readonly<Record<string, AiNet>>
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
  /** 開始監聽，立即送出一次目前內容，回傳停止函式 */
  watch(onChange: (snap: RaceSnapshot) => void): () => void
  /** 房主開新的一局：局數加一，房內玩家依加入先後排起跑格 */
  start(ai: number, cps: number): Promise<void>
  sendProgress(p: Progress): Promise<void>
  sendAi(ai: Record<string, AiNet>): Promise<void>
}

export const EMPTY_RACE: RaceSnapshot = { meta: null, progress: {}, ai: {} }

/** 單人用：資料放記憶體，自己就是房主 */
export function localRaceLink(selfId: string, name: string, now: () => number = Date.now): RaceLink {
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
    watch(onChange) {
      listeners.add(onChange)
      onChange(snap)
      return () => listeners.delete(onChange)
    },
    async start(ai, cps) {
      const meta: RaceMeta = { n: (snap.meta?.n ?? 0) + 1, ai, cps, at: now(), entrants: { [selfId]: 0 } }
      publish({ meta, progress: {}, ai: {} })
    },
    async sendProgress(p) {
      publish({ ...snap, progress: { ...snap.progress, [selfId]: p } })
    },
    async sendAi(ai) {
      publish({ ...snap, ai })
    },
  }
}

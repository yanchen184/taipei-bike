export const COUNTDOWN_MS = 3000
export const FINISH_GRACE_MS = 30_000
export const RACE_LIMIT_MS = 300_000
export const MAX_RACERS = 6
export const MAX_AI = 5

export interface RaceMeta {
  /** 局數，每開一局加一 */
  n: number
  /** AI 台數 */
  ai: number
  /** 檢查點數 */
  cps: number
  /** 開賽的伺服器時間（毫秒） */
  at: number
  /** 參賽玩家 uid → 起跑格 */
  entrants: Record<string, number>
}

/** fin：完成的伺服器時間 */
export interface Progress {
  n: number
  cp: number
  fin?: number
}

/** AI 的同步資料：位置、朝向、速度、下一個路口、已過檢查點、完成時間 */
export interface AiNet {
  n: number
  x: number
  z: number
  h: number
  s: number
  w: number
  cp: number
  fin?: number
}

/** 排名用的一位選手：dist = 離下一個檢查點的距離 */
export interface Standing {
  id: string
  cp: number
  fin?: number
  dist: number
}

export type RacePhase = 'countdown' | 'racing' | 'over'

/** 倒數結束、開始計時的伺服器時間 */
export function goTime(meta: RaceMeta): number {
  return meta.at + COUNTDOWN_MS
}

function compare(a: Standing, b: Standing): number {
  if (a.fin !== undefined || b.fin !== undefined) {
    if (a.fin === undefined) return 1
    if (b.fin === undefined) return -1
    if (a.fin !== b.fin) return a.fin - b.fin
  } else if (a.cp !== b.cp) {
    return b.cp - a.cp
  } else if (a.dist !== b.dist) {
    return a.dist - b.dist
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** 回傳新陣列：完成者依完成時間，未完成者依檢查點數、再依離下一檢查點的距離 */
export function rankRacers(standings: readonly Standing[]): Standing[] {
  return [...standings].sort(compare)
}

/** 最早的完成時間；records 要含已離開房間的選手 */
export function firstFinish(records: readonly { fin?: number }[]): number | undefined {
  const fins = records.flatMap((r) => (r.fin === undefined ? [] : [r.fin]))
  return fins.length === 0 ? undefined : Math.min(...fins)
}

/** standings 只含仍在房間內的選手；firstFin 是本局最早的完成時間（含已離開的選手） */
export function raceOver(meta: RaceMeta, standings: readonly Standing[], firstFin: number | undefined, now: number): boolean {
  if (now >= goTime(meta) + RACE_LIMIT_MS) return true
  if (firstFin === undefined) return false
  return standings.every((s) => s.fin !== undefined) || now >= firstFin + FINISH_GRACE_MS
}

export function racePhase(meta: RaceMeta, standings: readonly Standing[], firstFin: number | undefined, now: number): RacePhase {
  if (now < goTime(meta)) return 'countdown'
  return raceOver(meta, standings, firstFin, now) ? 'over' : 'racing'
}

/** 房內有 humans 位玩家時，最多能加幾台 AI */
export function aiLimit(humans: number): number {
  return Math.max(0, Math.min(MAX_AI, MAX_RACERS - humans))
}

export function aiId(k: number): string {
  return `ai${k}`
}

export function aiName(k: number): string {
  return `AI ${k + 1}`
}

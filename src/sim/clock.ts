/** 遊戲裡一天對應的現實秒數 */
export const DAY_SECONDS = 600
export const START_HOUR = 8
const NIGHT_START = 19
const NIGHT_END = 6

/** 世界時間 t（秒）對應的遊戲時刻，0–24 */
export function gameHour(t: number): number {
  const hour = START_HOUR + (t * 24) / DAY_SECONDS
  return ((hour % 24) + 24) % 24
}

export function isNight(t: number): boolean {
  const hour = gameHour(t)
  return hour >= NIGHT_START || hour < NIGHT_END
}

export function formatClock(t: number): string {
  const minutes = Math.floor(gameHour(t) * 60)
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

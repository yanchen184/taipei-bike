/** 體力（§9-13）：連續踩踏越久耗得越快，體力越低恢復越慢，耗盡後要恢復到一定程度才能再踩 */

/** 剛開始踩時每秒消耗的體力（滿格為 1） */
export const BASE_DRAIN = 0.06
/** 連續踩踏每多這麼多秒，消耗速度加倍 */
export const DOUBLING_SECONDS = 4
/** 不踩時連續踩踏的秒數以這個倍率倒退 */
export const EFFORT_RECOVERY = 2
/** 不踩時每秒恢復 REGEN_BASE + REGEN_RATE × 體力：剩越多恢復越快 */
export const REGEN_BASE = 0.04
export const REGEN_RATE = 0.25
/** 耗盡後要恢復到這個程度才能再踩 */
export const RECOVER_AT = 0.3

export interface Stamina {
  /** 0–1 */
  level: number
  /** 已經連續踩了幾秒（不踩時倒退） */
  effort: number
  /** 耗盡後還沒恢復到 RECOVER_AT */
  spent: boolean
}

export const FULL_STAMINA: Stamina = { level: 1, effort: 0, spent: false }

/** 現在踩踏每秒消耗多少體力 */
export function drainRate(effort: number): number {
  return BASE_DRAIN * 2 ** (effort / DOUBLING_SECONDS)
}

/** 不踩時每秒恢復多少體力 */
export function regenRate(level: number): number {
  return REGEN_BASE + REGEN_RATE * level
}

/** 推進 dt 秒；pedaling 是這段時間有沒有踩（耗盡時呼叫端不應傳 true） */
export function stepStamina(s: Stamina, pedaling: boolean, dt: number): Stamina {
  if (pedaling && !s.spent) {
    const level = Math.max(0, s.level - drainRate(s.effort) * dt)
    return { level, effort: s.effort + dt, spent: level <= 0 }
  }
  const level = Math.min(1, s.level + regenRate(s.level) * dt)
  return { level, effort: Math.max(0, s.effort - EFFORT_RECOVERY * dt), spent: s.spent && level < RECOVER_AT }
}

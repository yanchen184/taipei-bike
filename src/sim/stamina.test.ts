import { describe, expect, test } from 'vitest'
import { DOUBLING_SECONDS, FULL_STAMINA, RECOVER_AT, drainRate, stepStamina, type Stamina } from './stamina'

const DT = 1 / 60

function run(s: Stamina, pedaling: boolean, seconds: number): Stamina {
  let x = s
  for (let k = 0; k < Math.round(seconds / DT); k++) x = stepStamina(x, pedaling, DT)
  return x
}

/** 一直踩（或一直不踩）直到 done，回傳花的秒數與當下的體力 */
function until(s: Stamina, pedaling: boolean, done: (x: Stamina) => boolean): { t: number; at: Stamina } {
  let at = s
  let t = 0
  while (!done(at)) {
    at = stepStamina(at, pedaling, DT)
    t += DT
  }
  return { t, at }
}

function secondsUntil(s: Stamina, pedaling: boolean, done: (x: Stamina) => boolean): number {
  return until(s, pedaling, done).t
}

describe('B3 體力', () => {
  test('[B3-1] 連續踩踏每多 4 秒，每秒消耗的體力加倍', () => {
    expect(drainRate(DOUBLING_SECONDS) / drainRate(0)).toBeCloseTo(2)
    expect(drainRate(2 * DOUBLING_SECONDS) / drainRate(0)).toBeCloseTo(4)
    const first = 1 - run(FULL_STAMINA, true, 1).level
    const later = run(FULL_STAMINA, true, DOUBLING_SECONDS)
    const third = later.level - run(later, true, 1).level
    expect(third / first).toBeCloseTo(2, 1)
  })

  test('[B3-1] 從滿格一直踩，8 秒內耗盡；中間放開一下，連續踩踏的秒數會倒退', () => {
    expect(secondsUntil(FULL_STAMINA, true, (x) => x.spent)).toBeLessThan(8)
    const tired = run(FULL_STAMINA, true, 3)
    const rested = run(tired, false, 1)
    expect(rested.effort).toBeLessThan(tired.effort)
    expect(drainRate(rested.effort)).toBeLessThan(drainRate(tired.effort))
  })

  test('[B3-2] 不踩時體力越低恢復越慢：同樣補 0.1，剩 0.2 時花的時間是剩 0.8 時的 2 倍以上', () => {
    const low = secondsUntil({ ...FULL_STAMINA, level: 0.2 }, false, (x) => x.level >= 0.3)
    const high = secondsUntil({ ...FULL_STAMINA, level: 0.8 }, false, (x) => x.level >= 0.9)
    expect(low / high).toBeGreaterThan(2)
    expect(run({ ...FULL_STAMINA, level: 0.95 }, false, 5).level).toBe(1)
  })

  test('[B3-3] 耗盡後不能再踩，要恢復到 0.3 才行', () => {
    const spent = until(FULL_STAMINA, true, (x) => x.spent).at
    expect(spent).toMatchObject({ level: 0, spent: true })
    // 耗盡時踩也不耗、也不算連續踩踏，跟沒踩一樣恢復
    expect(stepStamina(spent, true, 1)).toEqual(stepStamina(spent, false, 1))
    const { t: back, at: recovered } = until(spent, false, (x) => !x.spent)
    expect(recovered.level).toBeGreaterThanOrEqual(RECOVER_AT)
    expect(recovered.level).toBeLessThan(RECOVER_AT + 0.01)
    expect(back).toBeGreaterThan(3)
  })
})

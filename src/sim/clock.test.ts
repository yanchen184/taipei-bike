import { describe, expect, test } from 'vitest'
import { DAY_SECONDS, gameHour, isNight } from './clock'

const hourToT = (hour: number) => (((hour - 8 + 24) % 24) * DAY_SECONDS) / 24

describe('C3 日夜循環', () => {
  test('[C3-1] 開局為 08:00，現實 10 分鐘走完一天', () => {
    expect(DAY_SECONDS).toBe(600)
    expect(gameHour(0)).toBe(8)
    expect(gameHour(25)).toBeCloseTo(9)
    expect(gameHour(300)).toBeCloseTo(20)
    expect(gameHour(600)).toBeCloseTo(8)
  })

  test('[C3-2] 19:00–06:00 判定為夜晚', () => {
    expect(isNight(hourToT(8))).toBe(false)
    expect(isNight(hourToT(18.99))).toBe(false)
    expect(isNight(hourToT(19))).toBe(true)
    expect(isNight(hourToT(0))).toBe(true)
    expect(isNight(hourToT(5.99))).toBe(true)
    expect(isNight(hourToT(6))).toBe(false)
  })
})

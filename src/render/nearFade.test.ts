import { describe, expect, test } from 'vitest'
import { FADE_FAR, FADE_MIN, fadeOpacity } from './nearFade'

describe('fadeOpacity', () => {
  test('[G2-5] 離相機 4 m 以上不透明，越近越透明，最低不低於下限', () => {
    expect(FADE_FAR).toBe(4)
    expect(fadeOpacity(FADE_FAR)).toBe(1)
    expect(fadeOpacity(10)).toBe(1)
    expect(fadeOpacity(3)).toBeLessThan(1)
    expect(fadeOpacity(2)).toBeLessThan(fadeOpacity(3))
    expect(fadeOpacity(0)).toBe(FADE_MIN)
    expect(FADE_MIN).toBeGreaterThan(0)
    expect(FADE_MIN).toBeLessThan(0.5)
  })
})

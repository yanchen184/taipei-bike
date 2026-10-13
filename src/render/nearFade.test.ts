import { describe, expect, test } from 'vitest'
import { FADE_AXIS, FADE_FAR, FADE_HIDE, fadeOpacity } from './nearFade'

describe('fadeOpacity', () => {
  test('[G2-5] 離相機 4 m 以上不透明，越近越透明，貼著相機時完全不畫', () => {
    expect(FADE_FAR).toBe(4)
    expect(fadeOpacity(FADE_FAR)).toBe(1)
    expect(fadeOpacity(10)).toBe(1)
    expect(fadeOpacity(3)).toBeLessThan(1)
    expect(fadeOpacity(3)).toBeGreaterThan(0)
    expect(fadeOpacity(2)).toBeLessThan(fadeOpacity(3))
    expect(FADE_HIDE).toBeGreaterThan(0)
    expect(FADE_HIDE).toBeLessThan(2)
    expect(fadeOpacity(FADE_HIDE)).toBe(0)
    expect(fadeOpacity(0)).toBe(0)
  })

  test('[G2-5] 不在相機視線上的選手（旁邊並騎的）維持不透明，只有貼著相機時不畫', () => {
    expect(fadeOpacity(3, FADE_AXIS + 0.1)).toBe(1)
    expect(fadeOpacity(2, FADE_AXIS + 0.1)).toBe(1)
    expect(fadeOpacity(3, FADE_AXIS - 0.1)).toBeLessThan(1)
    expect(fadeOpacity(1, FADE_AXIS + 5)).toBe(0)
  })
})

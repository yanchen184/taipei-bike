import { describe, expect, test } from 'vitest'
import { daylight } from './daylight'

describe('daylight', () => {
  test('[C3-3] 黃昏到 19:00 亮燈前仍有天光，不會先全黑', () => {
    expect(daylight(12)).toBeCloseTo(1, 1)
    for (const hour of [17, 18, 18.5, 18.9]) expect(daylight(hour)).toBeGreaterThan(0.3)
    expect(daylight(21)).toBe(0)
    expect(daylight(3)).toBe(0)
  })
})

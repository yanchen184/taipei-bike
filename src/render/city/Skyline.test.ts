import { describe, expect, test } from 'vitest'
import { CITY_SIZE } from '../../sim/city'
import { SKYLINE_DEPTH, skyline } from './Skyline'

describe('skyline', () => {
  const items = skyline(CITY_SIZE).flatMap((g) => g.items)
  const eps = 1e-6

  test('[C1-8] 外圍街屋全部在城市範圍外，不擋到任何道路', () => {
    for (const p of items) {
      const minX = p.x - p.sx / 2
      const maxX = p.x + p.sx / 2
      const minZ = p.z - p.sz / 2
      const maxZ = p.z + p.sz / 2
      const outside = maxX <= eps || minX >= CITY_SIZE - eps || maxZ <= eps || minZ >= CITY_SIZE - eps
      expect(outside).toBe(true)
    }
  })

  test('[C1-8] 四邊連續蓋滿，從城市裡任何方向看出去都是房子', () => {
    const hit = (x: number, z: number) =>
      items.some((p) => Math.abs(p.x - x) <= p.sx / 2 + eps && Math.abs(p.z - z) <= p.sz / 2 + eps)
    for (let s = 0; s < CITY_SIZE; s += 4) {
      expect(hit(s, -SKYLINE_DEPTH / 2)).toBe(true)
      expect(hit(s, CITY_SIZE + SKYLINE_DEPTH / 2)).toBe(true)
      expect(hit(-SKYLINE_DEPTH / 2, s)).toBe(true)
      expect(hit(CITY_SIZE + SKYLINE_DEPTH / 2, s)).toBe(true)
    }
  })

  test('樓高有高有低，不是一整排一樣高的牆', () => {
    const heights = new Set(items.map((p) => p.sy))
    expect(heights.size).toBeGreaterThan(3)
  })
})

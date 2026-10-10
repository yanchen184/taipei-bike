import { describe, expect, test } from 'vitest'
import { CAR_LANE_OFFSET, EW_ROAD_NAMES, NS_ROAD_NAMES, ROAD_COUNT, ROAD_WIDTH, generateCity, isOnRoad } from './city'
import { circleHitsRect, isFree, rectsOverlap } from './collide'
import { CAR_RADIUS } from './player'
import type { CityMap, Intersection, Rect } from './types'

const SEEDS = [1, 42, 20261009]

function roadRects(city: CityMap): Rect[] {
  const half = ROAD_WIDTH / 2
  return city.roads.map((road) =>
    road.axis === 'ew'
      ? { minX: 0, maxX: city.size, minZ: road.center - half, maxZ: road.center + half }
      : { minX: road.center - half, maxX: road.center + half, minZ: 0, maxZ: city.size },
  )
}

describe('C1 城市生成', () => {
  test('[C1-1] 同一個 seed 產生的地圖完全相同，不同 seed 的地圖不同', () => {
    expect(generateCity(42)).toEqual(generateCity(42))
    expect(generateCity(42)).not.toEqual(generateCity(43))
  })

  test('[C1-2] 道路網全部連通，從任一路段都能開到任一路段', () => {
    for (const seed of SEEDS) {
      const city = generateCity(seed)
      const byPos = new Map(city.intersections.map((n) => [`${n.i},${n.j}`, n]))
      const ewRoads = new Map(city.roads.filter((r) => r.axis === 'ew').map((r) => [r.index, r]))
      const nsRoads = new Map(city.roads.filter((r) => r.axis === 'ns').map((r) => [r.index, r]))

      /** 兩個相鄰路口之間，兩個方向的汽車道整段都沒有碰撞物 */
      const drivable = (a: Intersection, b: Intersection): boolean => {
        const road = a.j === b.j ? ewRoads.get(a.j) : nsRoads.get(a.i)
        if (!road) return false
        const [from, to] = road.axis === 'ew' ? [Math.min(a.x, b.x), Math.max(a.x, b.x)] : [Math.min(a.z, b.z), Math.max(a.z, b.z)]
        for (const side of [-1, 1]) {
          const lane = road.center + side * CAR_LANE_OFFSET
          for (let along = from; along <= to; along += 0.5) {
            const pos = road.axis === 'ew' ? { x: along, z: lane } : { x: lane, z: along }
            if (!isFree(pos, CAR_RADIUS, city.colliders)) return false
          }
        }
        return true
      }

      const first = city.intersections[0]!
      const seen = new Set<string>([first.id])
      const queue = [first]
      let edges = 0
      while (queue.length > 0) {
        const cur = queue.shift()!
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const next = byPos.get(`${cur.i + di},${cur.j + dj}`)
          if (!next || !drivable(cur, next)) continue
          edges += 1
          if (!seen.has(next.id)) {
            seen.add(next.id)
            queue.push(next)
          }
        }
      }
      expect(seen.size).toBe(city.intersections.length)
      expect(edges).toBe(2 * 2 * ROAD_COUNT * (ROAD_COUNT - 1))
    }
  })

  test('[C1-3] 建築物、樹、長椅都不與道路重疊', () => {
    for (const seed of SEEDS) {
      const city = generateCity(seed)
      const roads = roadRects(city)
      const rects = [
        ...city.buildings.map((b) => b.footprint),
        ...city.props.flatMap((p) => (p.kind !== 'lamp' && p.rect ? [p.rect] : [])),
      ]
      expect(city.props.some((p) => p.kind === 'tree')).toBe(true)
      expect(city.props.some((p) => p.kind === 'bench')).toBe(true)
      for (const rect of rects) {
        for (const road of roads) expect(rectsOverlap(rect, road)).toBe(false)
      }
    }
  })

  test('[C1-4] 至少 20 戶可拜訪住家，門牌全城不重複且格式為「○○路 N 號 F 樓」', () => {
    for (const seed of SEEDS) {
      const { homes } = generateCity(seed)
      expect(homes.length).toBeGreaterThanOrEqual(20)
      expect(new Set(homes.map((h) => h.address)).size).toBe(homes.length)
      expect(new Set(homes.map((h) => h.id)).size).toBe(homes.length)
      for (const home of homes) {
        expect(home.address).toMatch(/^\S+(路|大道) \d+ 號 \d+ 樓$/)
      }
    }
  })

  test('[C1-5] 每戶大門前 2 m 是可走的騎樓或人行道', () => {
    for (const seed of SEEDS) {
      const city = generateCity(seed)
      for (const home of city.homes) {
        for (let d = 0; d <= 2; d += 0.5) {
          const pos = {
            x: home.door.x + Math.sin(home.facing) * d,
            z: home.door.z + Math.cos(home.facing) * d,
          }
          expect(city.colliders.some((r) => circleHitsRect(pos, 0.35, r))).toBe(false)
        }
        const front = {
          x: home.door.x + Math.sin(home.facing) * 2.5,
          z: home.door.z + Math.cos(home.facing) * 2.5,
        }
        expect(isOnRoad(city, front)).toBe(true)
      }
    }
  })

  test('[C1-6] 地圖含一座全城最高的地標塔與一段高架捷運', () => {
    for (const seed of SEEDS) {
      const city = generateCity(seed)
      const towers = city.buildings.filter((b) => b.kind === 'tower')
      expect(towers).toHaveLength(1)
      const others = city.buildings.filter((b) => b.kind !== 'tower')
      expect(towers[0]!.height).toBeGreaterThan(Math.max(...others.map((b) => b.height), city.mrt.height))
      const mrtRoad = city.roads.find((r) => r.id === city.mrt.roadId)
      expect(mrtRoad?.axis).toBe('ns')
      expect(city.mrt.pillars.length).toBeGreaterThan(10)
      expect(city.mrt.stations.length).toBeGreaterThanOrEqual(1)
    }
  })

  test('[C1-7] 東西向與南北向道路使用規則 §1-3 的路名', () => {
    const city = generateCity(7)
    expect(EW_ROAD_NAMES).toEqual(['市民大道', '忠孝東路', '仁愛路', '信義路', '和平東路'])
    expect(NS_ROAD_NAMES).toEqual(['中山北路', '新生南路', '復興南路', '敦化南路', '光復南路'])
    const ew = city.roads.filter((r) => r.axis === 'ew').sort((a, b) => a.center - b.center)
    const ns = city.roads.filter((r) => r.axis === 'ns').sort((a, b) => a.center - b.center)
    expect(ew.map((r) => r.name)).toEqual(EW_ROAD_NAMES)
    expect(ns.map((r) => r.name)).toEqual(NS_ROAD_NAMES)
  })
})

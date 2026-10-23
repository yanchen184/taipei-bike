import { describe, expect, test } from 'vitest'
import { CAR_LANE_OFFSET, ROAD_COUNT, ROAD_WIDTH, generateCity, isOnRoad, roadNameAt } from './city'
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

  test('[C1-7] 東西向與南北向道路使用規則 §1-3 的路名與順序，中山路忠孝東路以北叫中山北路、以南叫中山南路', () => {
    const city = generateCity(7)
    const ew = city.roads.filter((r) => r.axis === 'ew').sort((a, b) => a.center - b.center)
    const ns = city.roads.filter((r) => r.axis === 'ns').sort((a, b) => a.center - b.center)
    expect(ew.map((r) => r.segments)).toEqual(
      ['市民大道', '忠孝東路', '仁愛路', '信義路', '和平東路'].map((name) => Array<string>(ROAD_COUNT - 1).fill(name)),
    )
    expect(ns.map((r) => r.segments)).toEqual([
      ['中山北路', '中山南路', '中山南路', '中山南路'],
      ...['新生南路', '復興南路', '敦化南路', '光復南路'].map((name) => Array<string>(ROAD_COUNT - 1).fill(name)),
    ])
    const zhongshan = ns[0]!
    const zhongxiao = ew[1]!.center
    expect(roadNameAt(zhongshan, zhongxiao - 5)).toBe('中山北路')
    expect(roadNameAt(zhongshan, zhongxiao + 5)).toBe('中山南路')
    for (const home of city.homes.filter((h) => h.roadName.startsWith('中山'))) {
      expect(home.roadName).toBe(home.door.z < zhongxiao ? '中山北路' : '中山南路')
    }
  })

  test('[C1-9] 每個 seed 的台北101、大安森林公園、東區商店街、文湖線與車站都在規則 §1-4 的固定位置', () => {
    for (const seed of SEEDS) {
      const city = generateCity(seed)
      const block = (i: number, j: number) => city.blocks.find((b) => b.i === i && b.j === j)!
      expect(block(3, 3)).toMatchObject({ kind: 'landmark', name: '台北101' })
      expect(block(1, 3)).toMatchObject({ kind: 'park', name: '大安森林公園' })
      expect(block(2, 0).kind).toBe('shops')
      expect(block(2, 1).kind).toBe('shops')
      expect(city.blocks.filter((b) => b.kind === 'landmark')).toHaveLength(1)
      expect(city.blocks.filter((b) => b.kind === 'park')).toHaveLength(2)
      expect(city.blocks.filter((b) => b.kind === 'shops')).toHaveLength(4)
      const tower = city.buildings.find((b) => b.kind === 'tower')!
      expect(tower.id).toBe('tower3-3')

      const mrtRoad = city.roads.find((r) => r.id === city.mrt.roadId)!
      expect(mrtRoad.segments[0]).toBe('復興南路')
      expect(city.mrt.name).toBe('文湖線')
      expect(city.mrt.stationNames).toEqual(['忠孝復興', '大安'])
      const ew = (index: number) => city.roads.find((r) => r.axis === 'ew' && r.index === index)!.center
      const [zx, da] = city.mrt.stations
      expect(zx!.maxZ).toBeLessThan(ew(1))
      expect(zx!.minZ).toBeGreaterThan(ew(0))
      expect(da!.maxZ).toBeLessThan(ew(3))
      expect(da!.minZ).toBeGreaterThan(ew(2))
    }
  })

  test('[C1-10] 每個路口有路名牌寫著交會的兩條路名，路名牌在人行道上不擋路；地標旁有地標名立牌', () => {
    for (const seed of SEEDS) {
      const city = generateCity(seed)
      const streets = city.signs.filter((s) => s.kind === 'street')
      for (const node of city.intersections) {
        const near = streets.filter((s) => Math.hypot(s.pos.x - node.x, s.pos.z - node.z) < ROAD_WIDTH)
        expect(near.length).toBe(2)
        const ewRoad = city.roads.find((r) => r.axis === 'ew' && r.index === node.j)!
        const nsRoad = city.roads.find((r) => r.axis === 'ns' && r.index === node.i)!
        for (const sign of near) {
          expect(sign.lines).toHaveLength(2)
          expect(ewRoad.segments).toContain(sign.lines[0])
          expect(sign.lines[1]).toBe(roadNameAt(nsRoad, sign.pos.z))
          expect(isOnRoad(city, sign.pos)).toBe(true)
          const fromLanes = Math.min(
            Math.abs(sign.pos.x - nsRoad.center),
            Math.abs(sign.pos.z - ewRoad.center),
          )
          expect(fromLanes).toBeGreaterThan(ROAD_WIDTH / 2 - 2)
        }
      }
      for (const name of ['台北101', '大安森林公園']) {
        const plaque = city.signs.find((s) => s.kind === 'landmark' && s.lines[0] === name)
        expect(plaque).toBeDefined()
        const block = city.blocks.find((b) => b.name === name)!
        const r = block.rect
        const gap = Math.max(r.minX - plaque!.pos.x, plaque!.pos.x - r.maxX, r.minZ - plaque!.pos.z, plaque!.pos.z - r.maxZ)
        expect(gap).toBeLessThan(3)
      }
      for (const sign of city.signs) {
        expect(city.colliders.some((c) => circleHitsRect(sign.pos, 0.2, c))).toBe(false)
      }
    }
  })
})

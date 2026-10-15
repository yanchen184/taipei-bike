import { describe, expect, test } from 'vitest'
import { STRIDE, generateCity, isOnRoad } from './city'
import { isFree } from './collide'
import { CHECKPOINT_RADIUS, GRID_SIZE, advanceCheckpoint, checkpointPos, generateCourse, nextTurn, type Course } from './course'
import { VEHICLE_SPEC, buildRoutes } from './traffic'
import type { Vec2 } from './types'
import { BIKE_SPEC } from './vehicle'

const SEEDS = [1, 3, 42, 2024, 99999]
const ROUNDS = Array.from({ length: 20 }, (_, k) => k + 1)

/** 點到線段的距離 */
function segmentDistance(p: Vec2, a: Vec2, d: Vec2, length: number): number {
  const u = Math.min(Math.max((p.x - a.x) * d.x + (p.z - a.z) * d.z, 0), length)
  return Math.hypot(p.x - (a.x + d.x * u), p.z - (a.z + d.z * u))
}

describe('K1 賽道生成', () => {
  test('[K1-1] 同一個 seed 與局數產生的賽道相同，換局數會換路線', () => {
    for (const seed of SEEDS) {
      const city = generateCity(seed)
      expect(generateCourse(generateCity(seed), 5)).toEqual(generateCourse(city, 5))
      for (const n of ROUNDS) {
        expect(generateCourse(city, n).n).toBe(n)
        expect(generateCourse(city, n + 1).nodes).not.toEqual(generateCourse(city, n).nodes)
      }
    }
    expect(generateCourse(generateCity(1), 1).nodes).not.toEqual(generateCourse(generateCity(3), 1).nodes)
  })

  test('[K1-2] 沿相鄰路口走 12–16 段、路口不重複，每 2 段一個檢查點共 6–8 個', () => {
    const lengths = new Set<number>()
    for (const seed of SEEDS) {
      const city = generateCity(seed)
      for (const n of ROUNDS) {
        const { nodes, checkpoints } = generateCourse(city, n)
        const segments = nodes.length - 1
        lengths.add(segments)
        expect(segments).toBeGreaterThanOrEqual(12)
        expect(segments).toBeLessThanOrEqual(16)
        for (const p of nodes) expect(city.intersections.some((x) => x.x === p.x && x.z === p.z)).toBe(true)
        expect(new Set(nodes.map((p) => `${p.x},${p.z}`)).size).toBe(nodes.length)
        for (let k = 1; k < nodes.length; k++) {
          const dx = Math.abs(nodes[k]!.x - nodes[k - 1]!.x)
          const dz = Math.abs(nodes[k]!.z - nodes[k - 1]!.z)
          expect(dx + dz).toBe(STRIDE)
          expect(Math.min(dx, dz)).toBe(0)
        }
        expect(checkpoints).toEqual(Array.from({ length: segments / 2 }, (_, k) => 2 * (k + 1)))
        expect(checkpoints.length).toBeGreaterThanOrEqual(6)
        expect(checkpoints.length).toBeLessThanOrEqual(8)
        expect(checkpoints.at(-1)).toBe(nodes.length - 1)
      }
    }
    expect([...lengths].sort()).toEqual([12, 14, 16])
  })

  test('[K1-3] 6 個起跑格在路面上、不與物體或彼此重疊、不在 NPC 汽機車的行車範圍內，朝向賽道第一段', () => {
    for (const seed of SEEDS) {
      const city = generateCity(seed)
      const routes = buildRoutes(city)
      for (const n of ROUNDS) {
        const { nodes, grid } = generateCourse(city, n)
        expect(grid).toHaveLength(GRID_SIZE)
        const [a, b] = [nodes[0]!, nodes[1]!]
        const toward = Math.atan2(b.x - a.x, b.z - a.z)
        const len = Math.hypot(b.x - a.x, b.z - a.z)
        for (const slot of grid) {
          expect(isOnRoad(city, slot.pos)).toBe(true)
          expect(isFree(slot.pos, BIKE_SPEC.radius, city.colliders)).toBe(true)
          expect(slot.heading).toBeCloseTo(toward, 12)
          const along = ((slot.pos.x - a.x) * (b.x - a.x) + (slot.pos.z - a.z) * (b.z - a.z)) / len
          expect(along).toBeGreaterThanOrEqual(10)
          expect(along).toBeLessThanOrEqual(30)
          for (const route of routes) {
            const clearance = VEHICLE_SPEC[route.kind].radius + BIKE_SPEC.radius
            for (const seg of route.segments) {
              expect(segmentDistance(slot.pos, seg, { x: seg.dx, z: seg.dz }, seg.length)).toBeGreaterThan(clearance)
            }
          }
        }
        for (let i = 0; i < grid.length; i++) {
          for (let j = i + 1; j < grid.length; j++) {
            const d = Math.hypot(grid[i]!.pos.x - grid[j]!.pos.x, grid[i]!.pos.z - grid[j]!.pos.z)
            expect(d).toBeGreaterThanOrEqual(2 * BIKE_SPEC.radius)
          }
        }
      }
    }
  })

  test('[K1-4] 只有騎進下一個檢查點 8 m 內才算通過，跳過的不算', () => {
    const course = generateCourse(generateCity(3), 1)
    const first = checkpointPos(course, 0)
    const second = checkpointPos(course, 1)
    expect(first).toEqual(course.nodes[2])
    expect(CHECKPOINT_RADIUS).toBe(8)
    expect(advanceCheckpoint(course, 0, { x: first.x + 7.9, z: first.z })).toBe(1)
    expect(advanceCheckpoint(course, 0, { x: first.x, z: first.z - 8 })).toBe(1)
    expect(advanceCheckpoint(course, 0, { x: first.x + 8.1, z: first.z })).toBe(0)
    expect(advanceCheckpoint(course, 0, second)).toBe(0)
    expect(advanceCheckpoint(course, 1, second)).toBe(2)
    const cps = course.checkpoints.length
    const finish = checkpointPos(course, cps - 1)
    expect(advanceCheckpoint(course, cps - 1, finish)).toBe(cps)
    expect(advanceCheckpoint(course, cps, finish)).toBe(cps)
  })
})

describe('G5 導航', () => {
  /** 往 +z 騎，在 B 右轉（往 -x）、C 左轉（往 +z）、D 直行，E 是終點 */
  const L: Course = {
    n: 1,
    nodes: [
      { x: 100, z: 0 },
      { x: 100, z: 76 },
      { x: 24, z: 76 },
      { x: 24, z: 152 },
      { x: 24, z: 228 },
    ],
    checkpoints: [2, 4],
    grid: [],
  }

  test('[G5-1] 下一個路口的轉向與距離，騎過路口中心才換下一個', () => {
    expect(nextTurn(L, 0, { x: 101, z: 20 })).toEqual({ node: 1, kind: 'right', dist: Math.hypot(1, 56) })
    expect(nextTurn(L, 0, { x: 100, z: 74 })?.node).toBe(1)
    expect(nextTurn(L, 0, { x: 90, z: 76 })).toEqual({ node: 2, kind: 'left', dist: 66 })
    // 檢查點在 8 m 外就算通過，這時仍提示檢查點那個路口怎麼轉
    expect(nextTurn(L, 1, { x: 30, z: 77 })).toMatchObject({ node: 2, kind: 'left' })
    expect(nextTurn(L, 1, { x: 24, z: 120 })).toEqual({ node: 3, kind: 'straight', dist: 32 })
    expect(nextTurn(L, 1, { x: 24, z: 180 })).toEqual({ node: 4, kind: 'finish', dist: 48 })
    expect(nextTurn(L, 2, { x: 24, z: 228 })).toBeNull()
  })

  test('[G5-1] 只在上一個檢查點的前一段到下一個檢查點之間找，不會被平行的路線路段帶走', () => {
    // 離第 3 段（往終點那段）比較近，但還沒通過第一個檢查點
    expect(nextTurn(L, 0, { x: 30, z: 200 })?.node).toBeLessThanOrEqual(2)
  })

  test('[G5-1] 多個 seed 的賽道：沿路線騎，每段都提示下一個路口，轉向與叉積一致', () => {
    for (const seed of SEEDS) {
      const city = generateCity(seed)
      for (const n of ROUNDS) {
        const course = generateCourse(city, n)
        const { nodes, checkpoints } = course
        for (let k = 0; k < nodes.length - 1; k++) {
          const a = nodes[k]!
          const b = nodes[k + 1]!
          const pos = { x: a.x + (b.x - a.x) * 0.7, z: a.z + (b.z - a.z) * 0.7 }
          const cp = checkpoints.filter((c) => c <= k).length
          const turn = nextTurn(course, cp, pos)!
          expect(turn.node).toBe(k + 1)
          expect(turn.dist).toBeCloseTo(STRIDE * 0.3, 5)
          const c = nodes[k + 2]
          if (!c) {
            expect(turn.kind).toBe('finish')
            continue
          }
          const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)
          expect(turn.kind).toBe(cross === 0 ? 'straight' : cross > 0 ? 'right' : 'left')
        }
      }
    }
  })
})

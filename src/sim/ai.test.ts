import { describe, expect, test } from 'vitest'
import { AI_STEP, aiDriver, createAi, parkSlot, riderCircles, stepAi, type AiDriver, type AiRider } from './ai'
import { aiBuild } from './balance'
import { ROAD_COUNT, ROAD_WIDTH, SIDEWALK, generateCity, roadCenter } from './city'
import { isFree, type Circle } from './collide'
import { CHECKPOINT_RADIUS, checkpointPos, generateCourse, type Course } from './course'
import { DEFAULT_BUILD } from './parts'
import { RACE_LIMIT_MS } from './race'
import { advanceTraffic, buildRoutes, initTraffic, writeVehicleCircles, type TrafficState } from './traffic'
import { BIKE_SPEC } from './vehicle'
import type { CityMap, Vec2 } from './types'

const STEPS_PER_SECOND = Math.round(1 / AI_STEP)
const ASPHALT_HALF = ROAD_WIDTH / 2 - SIDEWALK
const ROADS = Array.from({ length: ROAD_COUNT }, (_, i) => roadCenter(i))

/** 在某條道路的柏油路面上（含路口），容許壓到路緣 margin 公尺：人行道在道路兩側最外面 SIDEWALK 公尺 */
function onAsphalt(pos: Vec2, margin: number): boolean {
  const half = ASPHALT_HALF + margin
  return ROADS.some((c) => Math.abs(pos.x - c) <= half || Math.abs(pos.z - c) <= half)
}

/** 第 k 台 AI 用自己這一局的組裝 */
function drivers(city: CityMap, course: Course, ks: number[]): AiDriver[] {
  return ks.map((k) => aiDriver(k, aiBuild(course, city.seed, k)))
}

/** NPC 交通依時間推進；together 為 true 時 AI 之間互撞，否則各自單獨跑 */
function simulate(city: CityMap, course: Course, ks: number[], seconds: number, together = false, observe?: (riders: AiRider[]) => void) {
  const ds = drivers(city, course, ks)
  const routes = buildRoutes(city)
  let traffic: TrafficState = initTraffic(city)
  const npc: Circle[] = []
  let riders: AiRider[] = ks.map((k) => createAi(course, k))
  const finishedAt: (number | null)[] = ks.map(() => null)
  for (let step = 1; step <= seconds * STEPS_PER_SECOND; step++) {
    traffic = advanceTraffic(traffic, routes, step * AI_STEP)
    npc.length = writeVehicleCircles(routes, traffic.vehicles, npc)
    riders = riders.map((ai, i) => {
      const others = together ? riderCircles(riders.filter((_, j) => j !== i).map((o) => ({ pos: o.bike.pos, fin: o.fin }))) : []
      return stepAi(ai, ds[i]!, course, AI_STEP, city.colliders, [...npc, ...others])
    })
    observe?.(riders)
    riders.forEach((ai, i) => {
      if (ai.fin && finishedAt[i] === null) finishedAt[i] = step * AI_STEP
    })
    if (finishedAt.every((t) => t !== null)) break
  }
  return { riders, finishedAt }
}

describe('A1 AI 騎士', () => {
  test('[A1-1] 給定賽道、起跑格與時間步，AI 的位置完全確定', () => {
    const city = generateCity(3)
    const course = generateCourse(city, 2)
    const a = simulate(city, course, [0, 2, 4], 20).riders
    const b = simulate(generateCity(3), generateCourse(generateCity(3), 2), [0, 2, 4], 20).riders
    expect(b).toEqual(a)
    expect(a[0]!.bike.pos).not.toEqual(course.grid[0]!.pos)
  })

  test('[A1-2] 每台 AI 單獨在有 NPC 交通的城市中都能在 5 分鐘內騎完賽道', () => {
    for (const [seed, n] of [[3, 1], [42, 2], [2024, 3], [7, 4]] as const) {
      const city = generateCity(seed)
      const course = generateCourse(city, n)
      const { riders, finishedAt } = simulate(city, course, [0, 1, 2, 3, 4], RACE_LIMIT_MS / 1000)
      for (const [i, t] of finishedAt.entries()) {
        expect(t, `seed ${seed} 局 ${n} AI ${i + 1}`).not.toBeNull()
        expect(riders[i]!.cp).toBe(course.checkpoints.length)
      }
    }
  }, 120_000)

  test('[A1-6] 5 台 AI 同場互撞加上 NPC 交通，全部能在 5 分鐘內騎完賽道', () => {
    for (const [seed, n] of [[1, 1], [9, 3], [999, 1], [31337, 3]] as const) {
      const city = generateCity(seed)
      const course = generateCourse(city, n)
      const { riders, finishedAt } = simulate(city, course, [0, 1, 2, 3, 4], RACE_LIMIT_MS / 1000, true)
      for (const [i, t] of finishedAt.entries()) {
        expect(t, `seed ${seed} 局 ${n} AI ${i + 1}`).not.toBeNull()
        expect(riders[i]!.cp).toBe(course.checkpoints.length)
      }
    }
  }, 120_000)

  test('[A1-6] 已完賽的選手不產生碰撞圓', () => {
    const circles = riderCircles([
      { pos: { x: 1, z: 2 }, fin: false },
      { pos: { x: 5, z: 5 }, fin: true },
    ])
    expect(circles).toEqual([{ pos: { x: 1, z: 2 }, radius: BIKE_SPEC.radius }])
  })

  test('[A1-8] 完賽的 AI 騎到終點後方人行道各自的位置停好，不疊在一起、不擋終點', () => {
    for (const [seed, n] of [[1, 1], [9, 3], [42, 2]] as const) {
      const city = generateCity(seed)
      const course = generateCourse(city, n)
      const ks = [0, 1, 2, 3, 4]
      let { riders } = simulate(city, course, ks, RACE_LIMIT_MS / 1000, true)
      const ds = drivers(city, course, ks)
      for (let step = 0; step < 20 * STEPS_PER_SECOND; step++) riders = riders.map((ai, i) => stepAi(ai, ds[i]!, course, AI_STEP, city.colliders, []))
      const finish = checkpointPos(course, course.checkpoints.length - 1)
      riders.forEach((ai, i) => {
        const label = `seed ${seed} 局 ${n} AI ${i + 1}`
        const slot = parkSlot(course, i, city.colliders)
        expect(Math.hypot(ai.bike.pos.x - slot.x, ai.bike.pos.z - slot.z), label).toBeLessThan(0.5)
        expect(ai.bike.speed, label).toBe(0)
        expect(isFree(ai.bike.pos, BIKE_SPEC.radius, city.colliders), label).toBe(true)
        expect(Math.hypot(ai.bike.pos.x - finish.x, ai.bike.pos.z - finish.z), label).toBeGreaterThan(CHECKPOINT_RADIUS)
        riders.slice(i + 1).forEach((o) => {
          expect(Math.hypot(ai.bike.pos.x - o.bike.pos.x, ai.bike.pos.z - o.bike.pos.z), label).toBeGreaterThan(2 * BIKE_SPEC.radius)
        })
      })
    }
  }, 120_000)

  test('[A1-3] AI 3 秒內移動不到 3 m 時移回最後經過的路口並朝向下一段', () => {
    const city = generateCity(3)
    const course = generateCourse(city, 1)
    const [a, b] = [course.nodes[0]!, course.nodes[1]!]
    let ai = createAi(course, 0)
    const slot = ai.bike.pos
    /** 起跑格四周一圈彼此重疊的碰撞圓，AI 最多只能移動 0.1 m */
    const ring: Circle[] = Array.from({ length: 8 }, (_, k) => ({
      pos: { x: slot.x + 2 * Math.cos((k * Math.PI) / 4), z: slot.z + 2 * Math.sin((k * Math.PI) / 4) },
      radius: 1.3,
    }))
    let respawnedAt: number | null = null
    for (let step = 1; step <= 4 * STEPS_PER_SECOND && respawnedAt === null; step++) {
      ai = stepAi(ai, aiDriver(0, DEFAULT_BUILD), course, AI_STEP, city.colliders, ring)
      if (ai.bike.pos.x === a.x && ai.bike.pos.z === a.z) respawnedAt = step * AI_STEP
    }
    expect(respawnedAt).not.toBeNull()
    expect(respawnedAt!).toBeGreaterThanOrEqual(3)
    expect(respawnedAt!).toBeLessThan(3 + 2 * AI_STEP)
    expect(ai.bike.heading).toBeCloseTo(Math.atan2(b.x - a.x, b.z - a.z), 12)
    expect(ai.bike.speed).toBe(0)
    expect(ai.wp).toBe(1)

    const free = simulate(city, course, [0], 10).riders[0]!
    expect(Math.hypot(free.bike.pos.x - a.x, free.bike.pos.z - a.z)).toBeGreaterThan(30)
  })

  test('[A1-5] AI 撞到選手或其他 AI 時被推開並反彈', () => {
    const city = generateCity(3)
    const course = generateCourse(city, 1)
    const start = createAi(course, 0)
    const { pos, heading } = start.bike
    const other: Circle = { pos: { x: pos.x + Math.sin(heading) * 2, z: pos.z + Math.cos(heading) * 2 }, radius: BIKE_SPEC.radius }
    let ai: AiRider = { ...start, bike: { ...start.bike, speed: 8 } }
    let bounced = false
    for (let step = 0; step < STEPS_PER_SECOND; step++) {
      ai = stepAi(ai, aiDriver(0, DEFAULT_BUILD), course, AI_STEP, city.colliders, [other])
      if (ai.bike.speed < 0) bounced = true
      const d = Math.hypot(ai.bike.pos.x - other.pos.x, ai.bike.pos.z - other.pos.z)
      expect(d).toBeGreaterThanOrEqual(2 * BIKE_SPEC.radius - 1e-9)
    }
    expect(bounced).toBe(true)
  })

  test('[A1-7] AI 騎在柏油路面上，被撞開時最多壓到路緣，不上人行道', () => {
    const summary: string[] = []
    for (const [seed, n] of [[3, 1], [42, 2], [999, 1], [9, 3], [2024, 3], [7, 4], [1, 1], [31337, 3]] as const) {
      const city = generateCity(seed)
      const course = generateCourse(city, n)
      const off: string[] = []
      simulate(city, course, [0, 1, 2, 3, 4], RACE_LIMIT_MS / 1000, true, (riders) =>
        riders.forEach((ai, i) => {
          if (!ai.fin && !onAsphalt(ai.bike.pos, BIKE_SPEC.radius)) off.push(`AI ${i + 1} (${ai.bike.pos.x.toFixed(1)}, ${ai.bike.pos.z.toFixed(1)})`)
        }),
      )
      if (off.length > 0) summary.push(`seed ${seed} 局 ${n}: ${off.length} ${off.slice(0, 2).join(' ')} … ${off.slice(-1).join('')}`)
    }
    expect(summary).toEqual([])
  }, 120_000)
})

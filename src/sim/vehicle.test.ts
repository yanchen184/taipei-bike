import { describe, expect, test } from 'vitest'
import { generateCity, roadCenter } from './city'
import { circleHitsRect, type Circle } from './collide'
import { createPlayer, mountBike, stepPlayer, type PlayerInput, type PlayerState } from './player'
import { BIKE_SPEC, BOUNCE, substeps } from './vehicle'
import type { CityMap, Pose } from './types'

const city = generateCity(3)
const openCity: CityMap = { ...city, colliders: [] }
const DT = 1 / 30
/** 腳踏車最高速時也只切成一個子步的步長 */
const FINE_DT = 1 / 120
const IDLE: PlayerInput = { forward: 0, right: 0, run: false, handbrake: false, cameraYaw: 0 }
const EAST = Math.PI / 2

function rider(pose: Pose, speed = 0): PlayerState {
  const s = mountBike(createPlayer(city), pose)
  return { ...s, bike: { ...s.bike!, speed } }
}

function ride(state: PlayerState, input: Partial<PlayerInput>, seconds: number, map: CityMap, dt = DT, obstacles: Circle[] = []) {
  const frames: PlayerState[] = []
  let s = state
  for (let n = 0; n < Math.round(seconds / dt); n++) {
    s = stepPlayer(s, { ...IDLE, ...input }, dt, map, obstacles)
    frames.push(s)
  }
  return { state: s, frames }
}

describe('B1 騎車', () => {
  test('[B1-1] 按住 W 加速，速度不超過 12 m/s', () => {
    const { state, frames } = ride(rider({ pos: { x: 160, z: 160 }, heading: 0 }), { forward: 1 }, 6, openCity)
    expect(BIKE_SPEC.maxSpeed).toBe(12)
    expect(frames[0]!.bike!.speed).toBeGreaterThan(0)
    expect(Math.max(...frames.map((f) => f.bike!.speed))).toBeLessThanOrEqual(12)
    expect(state.bike!.speed).toBe(12)
    expect(state.mode).toBe('bike')
    expect(state.pos).toEqual(state.bike!.pos)
    expect(state.pos.z).toBeGreaterThan(160)
  })

  test('[B1-2] 按 S 先煞停再倒退，倒退不超過 3 m/s', () => {
    const { frames } = ride(rider({ pos: { x: 160, z: 160 }, heading: 0 }, 12), { forward: -1 }, 6, openCity)
    const speeds = frames.map((f) => f.bike!.speed)
    const stopped = speeds.findIndex((v) => v <= 0)
    expect(stopped).toBeGreaterThan(0)
    expect(speeds.slice(0, stopped).every((v, k) => k === 0 || v < speeds[k - 1]!)).toBe(true)
    expect(Math.min(...speeds)).toBe(-3)
    expect(speeds.at(-1)).toBe(-3)
  })

  test('[B1-3] 靜止時按 A/D 車頭方向不變，行進時會轉向', () => {
    const still = ride(rider({ pos: { x: 160, z: 160 }, heading: 0.4 }), { right: 1 }, 2, openCity).state
    expect(still.heading).toBe(0.4)
    expect(still.bike!.heading).toBe(0.4)
    const moving = ride(rider({ pos: { x: 160, z: 160 }, heading: 0.4 }, 8), { forward: 1, right: 1 }, 0.5, openCity).state
    expect(moving.bike!.heading).toBeLessThan(0.4)
    const left = ride(rider({ pos: { x: 160, z: 160 }, heading: 0.4 }, 8), { forward: 1, right: -1 }, 0.5, openCity).state
    expect(left.bike!.heading).toBeGreaterThan(0.4)
  })

  test('[B1-4] 撞邊界牆後被推回牆外，速度變為反向 30%', () => {
    const start = rider({ pos: { x: 250, z: roadCenter(2) }, heading: EAST }, BIKE_SPEC.maxSpeed)
    const { frames } = ride(start, { forward: 1 }, 10, city, FINE_DT)
    const hit = frames.findIndex((f, k) => k > 0 && f.bike!.speed < 0)
    expect(hit).toBeGreaterThan(0)
    expect(frames[hit - 1]!.bike!.speed).toBe(BIKE_SPEC.maxSpeed)
    expect(frames[hit]!.bike!.speed).toBeCloseTo(-BIKE_SPEC.maxSpeed * BOUNCE, 9)
    expect(BOUNCE).toBe(0.3)
    for (const f of frames) {
      expect(city.colliders.some((r) => circleHitsRect(f.bike!.pos, BIKE_SPEC.radius, r))).toBe(false)
      expect(f.bike!.pos.x).toBeLessThanOrEqual(city.size - BIKE_SPEC.radius + 1e-9)
    }
  })

  test('[B1-4] 撞建築物後被推回建築物外，速度變為反向 30%', () => {
    const building = city.colliders.find((r) => r.maxX - r.minX > 4 && r.maxZ - r.minZ > 4)!
    const onlyBuilding: CityMap = { ...city, colliders: [building] }
    const z = (building.minZ + building.maxZ) / 2
    const start = rider({ pos: { x: building.minX - 5, z }, heading: EAST }, BIKE_SPEC.maxSpeed)
    const { frames } = ride(start, { forward: 1 }, 10, onlyBuilding, FINE_DT)
    const hit = frames.findIndex((f, k) => k > 0 && f.bike!.speed < 0)
    expect(hit).toBeGreaterThan(0)
    expect(frames[hit - 1]!.bike!.speed).toBe(BIKE_SPEC.maxSpeed)
    expect(frames[hit]!.bike!.speed).toBeCloseTo(-BIKE_SPEC.maxSpeed * BOUNCE, 9)
    for (const f of frames) expect(circleHitsRect(f.bike!.pos, BIKE_SPEC.radius, building)).toBe(false)
  })

  test('子步數：dt 或最高速不是非負有限數時拋出 RangeError', () => {
    expect(substeps(12, 1 / 30)).toBe(2)
    expect(substeps(12, 0)).toBe(1)
    for (const dt of [Infinity, NaN, -0.1]) expect(() => substeps(12, dt)).toThrow(RangeError)
    for (const max of [Infinity, NaN, -1]) expect(() => substeps(max, 1 / 30)).toThrow(RangeError)
  })

  test('[B1-5] 撞到碰撞圓（NPC 車、選手、AI）時被推開並反彈', () => {
    const other: Circle = { pos: { x: 160, z: 166 }, radius: BIKE_SPEC.radius }
    const start = rider({ pos: { x: 160, z: 160 }, heading: 0 }, 10)
    const { frames } = ride(start, { forward: 1 }, 1, openCity, FINE_DT, [other])
    const hit = frames.findIndex((f) => f.bike!.speed < 0)
    expect(hit).toBeGreaterThanOrEqual(0)
    for (const f of frames) {
      const d = Math.hypot(f.bike!.pos.x - other.pos.x, f.bike!.pos.z - other.pos.z)
      expect(d).toBeGreaterThanOrEqual(BIKE_SPEC.radius + other.radius - 1e-9)
    }
  })
})

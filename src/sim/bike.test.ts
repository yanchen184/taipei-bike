import { describe, expect, test } from 'vitest'
import { rect, type Circle } from './collide'
import type { Rect } from './types'
import {
  BALANCE_SPEED,
  CRASH_SPEED,
  DOWN_SECONDS,
  MAX_LEAN,
  WOBBLE_SECONDS,
  isDown,
  restingBike,
  stepBike,
  type BikeState,
} from './bike'
import { BIKE_SPEC, BOUNCE, type DriveInput } from './vehicle'

const DT = 1 / 120
const IDLE: DriveInput = { forward: 0, right: 0, handbrake: false }
/** x = 10 起的一道牆 */
const WALL: Rect[] = [rect(10, -50, 12, 50)]
const EAST = Math.PI / 2

function moving(speed: number, heading = 0, x = 0): BikeState {
  return { ...restingBike({ pos: { x, z: 0 }, heading }), speed }
}

function ride(b: BikeState, input: Partial<DriveInput>, seconds: number, colliders: Rect[] = [], obstacles: Circle[] = []) {
  const frames: BikeState[] = []
  let s = b
  for (let n = 0; n < Math.round(seconds / DT); n++) {
    s = stepBike(s, BIKE_SPEC, { ...IDLE, ...input }, DT, colliders, obstacles)
    frames.push(s)
  }
  return { state: s, frames }
}

describe('B2 摔車', () => {
  test('[B2-1] 撞牆時速度超過 1 m/s 就摔車：速度歸零、倒向一側', () => {
    const { frames } = ride(moving(6, EAST, 5), { forward: 1 }, 2, WALL)
    const crash = frames.findIndex(isDown)
    expect(crash).toBeGreaterThan(0)
    expect(frames[crash - 1]!.speed).toBeGreaterThan(CRASH_SPEED)
    expect(frames[crash]!.speed).toBe(0)
    expect(frames[crash]!.down).toBeCloseTo(DOWN_SECONDS, 9)
    expect(Math.abs(frames[crash]!.lean)).toBeCloseTo(Math.PI / 2, 9)
    for (const f of frames) expect(f.pos.x).toBeLessThanOrEqual(10 - BIKE_SPEC.radius + 1e-9)
  })

  test('[B2-1] 撞到碰撞圓（NPC 車、選手、AI）同樣摔車', () => {
    const other: Circle = { pos: { x: 0, z: 4 }, radius: 1.6 }
    const { frames } = ride(moving(8), { forward: 1 }, 1, [], [other])
    expect(frames.some(isDown)).toBe(true)
  })

  test('[B2-1] 撞擊速度 1 m/s 以下只反彈，速度變為反向 30%', () => {
    const start = { ...moving(0.9, EAST, 10 - BIKE_SPEC.radius - 0.005) }
    const { frames } = ride(start, {}, 0.2, WALL)
    const hit = frames.findIndex((f) => f.speed < 0)
    expect(hit).toBeGreaterThanOrEqual(0)
    expect(frames.some(isDown)).toBe(false)
    expect(frames[hit]!.speed).toBeLessThan(0)
    expect(Math.abs(frames[hit]!.speed)).toBeLessThanOrEqual(CRASH_SPEED * BOUNCE)
  })

  test('[B2-2] 倒地 2 秒不能操作，之後在原地扶起，速度 0、車頭不變', () => {
    const crashed = ride(moving(6, EAST, 5), { forward: 1 }, 2, WALL).frames.find(isDown)!
    const lying = ride(crashed, { forward: 1, right: 1 }, DOWN_SECONDS - 0.1, WALL)
    for (const f of lying.frames) {
      expect(f.pos).toEqual(crashed.pos)
      expect(f.heading).toBe(crashed.heading)
      expect(f.speed).toBe(0)
      expect(isDown(f)).toBe(true)
    }
    const up = ride(lying.state, {}, 0.2, WALL).state
    expect(isDown(up)).toBe(false)
    expect(up.speed).toBeCloseTo(0, 9)
    expect(up.lean).toBeCloseTo(0, 9)
    expect(up.heading).toBe(crashed.heading)
    expect(up.pos).toEqual(crashed.pos)
  })

  test('[B2-3] 速度在 1–2.5 m/s 之間按住轉向 0.8 秒就倒，0.8 秒前不倒', () => {
    expect(BALANCE_SPEED).toBe(2.5)
    expect(WOBBLE_SECONDS).toBe(0.8)
    const { frames } = ride(moving(2.4), { right: 1 }, 1.2)
    const crash = frames.findIndex(isDown)
    expect(crash).toBeGreaterThan(0)
    expect((crash + 1) * DT).toBeCloseTo(WOBBLE_SECONDS, 1)
    expect(frames[crash - 1]!.wobble).toBeGreaterThan(0)
    expect(frames[crash]!.speed).toBe(0)
  })

  test('[B2-3] 腳踩地（< 1 m/s）、倒退、轉向不到一半、加速超過 2.5 m/s 時不倒，晃動歸零', () => {
    expect(ride(moving(0.9), { right: 1 }, 2).frames.some(isDown)).toBe(false)
    expect(ride(moving(-2), { right: 1 }, 2).frames.some(isDown)).toBe(false)
    expect(ride(moving(2.4), { right: 0.4 }, 2).frames.some(isDown)).toBe(false)
    const pedaling = ride(moving(1.2), { forward: 1, right: 1 }, 2)
    expect(pedaling.frames.some(isDown)).toBe(false)
    expect(pedaling.state.wobble).toBe(0)
    const released = ride(ride(moving(2.4), { right: 1 }, 0.5).state, {}, DT)
    expect(released.state.wobble).toBe(0)
  })

  test('[B2-4] 轉彎時車身往彎內傾斜，不超過最大傾角；直騎時不傾斜', () => {
    expect(ride(moving(8), { forward: 1, right: 1 }, 0.3).state.lean).toBeGreaterThan(0)
    expect(ride(moving(8), { forward: 1, right: -1 }, 0.3).state.lean).toBeLessThan(0)
    expect(ride(moving(8), { forward: 1 }, 0.3).state.lean).toBe(0)
    const hard = ride(moving(12), { forward: 1, right: 1 }, 0.3).frames
    for (const f of hard) expect(Math.abs(f.lean)).toBeLessThanOrEqual(MAX_LEAN)
  })
})

describe('B3 體力（騎車）', () => {
  test('[B3-4] 按住 W 往前踩會耗體力，放開、煞車與倒退都不耗而是恢復', () => {
    const pedaled = ride(moving(0), { forward: 1 }, 2).state
    expect(pedaled.stamina.level).toBeLessThan(1)
    const tired = { ...moving(6), stamina: { level: 0.5, effort: 0, spent: false } }
    expect(ride(tired, {}, 1).state.stamina.level).toBeGreaterThan(0.5)
    expect(ride(tired, { forward: -1 }, 1).state.stamina.level).toBeGreaterThan(0.5)
  })

  test('[B3-4] 體力耗盡時按 W 也踩不動，只會滑行減速；恢復到 0.3 後又能加速', () => {
    const { frames } = ride(moving(0), { forward: 1 }, 14)
    const empty = frames.findIndex((f) => f.stamina.spent)
    expect(empty).toBeGreaterThan(0)
    const after = frames.slice(empty + 1, empty + 60)
    for (const [k, f] of after.entries()) expect(f.speed).toBeLessThanOrEqual((k === 0 ? frames[empty]! : after[k - 1]!).speed)
    // 耗盡後約 4 秒恢復，又踩得動、速度往上
    const back = frames.findIndex((f, k) => k > empty && !f.stamina.spent)
    expect((back - empty) * DT).toBeGreaterThan(3)
    expect(frames[back + 30]!.speed).toBeGreaterThan(frames[back]!.speed)
  })

  test('[B3-4] 摔車倒地期間體力照常恢復', () => {
    const tired = { ...moving(6, EAST, 5), stamina: { level: 0.4, effort: 0, spent: false } }
    const { frames } = ride(tired, { forward: 1 }, 2, WALL)
    const crash = frames.findIndex(isDown)
    expect(frames[crash + 100]!.stamina.level).toBeGreaterThan(frames[crash]!.stamina.level)
  })
})

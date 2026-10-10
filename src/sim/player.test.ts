import { describe, expect, test } from 'vitest'
import { CAR_LANE_OFFSET, ROAD_WIDTH, SIDEWALK, generateCity, isOnRoad } from './city'
import { circleHitsRect } from './collide'
import {
  CAR_RADIUS,
  ENTER_CAR_DISTANCE,
  MAX_REVERSE,
  MAX_SPEED,
  WALK_RADIUS,
  callCar,
  createPlayer,
  enterCar,
  exitCar,
  resetCar,
  stepPlayer,
  type PlayerInput,
  type PlayerState,
} from './player'
import type { CityMap, Vec2 } from './types'

const city = generateCity(3)
const openCity: CityMap = { ...city, colliders: [] }
const DT = 1 / 30
/** 最高速時也只切成一個子步的步長，用來觀察單一子步內的速度變化 */
const FINE_DT = 1 / 120
const IDLE: PlayerInput = { forward: 0, right: 0, run: false, handbrake: false, cameraYaw: 0 }

function run(state: PlayerState, input: Partial<PlayerInput>, seconds: number, map: CityMap = city): PlayerState {
  let s = state
  for (let n = 0; n < Math.round(seconds / DT); n++) s = stepPlayer(s, { ...IDLE, ...input }, DT, map)
  return s
}

function walker(pos: Vec2): PlayerState {
  const base = createPlayer(city)
  return { ...base, mode: 'walk', pos, car: { ...base.car, pos: { x: -100, z: -100 } } }
}

function driver(pos: Vec2, heading: number, speed: number): PlayerState {
  const base = createPlayer(city)
  return { ...base, mode: 'drive', pos, heading, car: { pos, heading, speed } }
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z)
const hitsAny = (pos: Vec2, r: number) => city.colliders.some((rect) => circleHitsRect(pos, r, rect))
const isAxisAligned = (h: number) => Math.abs(Math.sin(2 * h)) < 1e-9

/** 逐條汽車道算點到車道線段的最短距離 */
function nearestLaneDistance(p: Vec2): number {
  const lo = ROAD_WIDTH / 2
  const hi = city.size - ROAD_WIDTH / 2
  let best = Infinity
  for (const road of city.roads) {
    for (const side of [-1, 1]) {
      const lane = road.center + side * CAR_LANE_OFFSET
      const along = road.axis === 'ew' ? p.x : p.z
      const across = road.axis === 'ew' ? p.z : p.x
      const outside = along < lo ? lo - along : along > hi ? along - hi : 0
      best = Math.min(best, Math.hypot(outside, across - lane))
    }
  }
  return best
}

/** 車停在汽車道上，朝向符合靠右行駛 */
function expectOnNearestLane(pos: Vec2, heading: number, from: Vec2): void {
  expect(dist(pos, from)).toBeCloseTo(nearestLaneDistance(from), 9)
  const road = city.roads.find((r) => Math.abs((r.axis === 'ew' ? pos.z : pos.x) - r.center) === CAR_LANE_OFFSET)
  expect(road).toBeDefined()
  const side = Math.sign((road!.axis === 'ew' ? pos.z : pos.x) - road!.center)
  const expected = road!.axis === 'ew' ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : side > 0 ? Math.PI : 0
  expect(Math.cos(heading - expected)).toBeCloseTo(1, 9)
}

describe('D1 步行', () => {
  test('[D1-1] WASD 依相機方向移動，步行 4 m/s、Shift 跑步 7 m/s', () => {
    const start = { x: 160, z: 160 }
    const walked = run(walker(start), { forward: 1 }, 1, openCity)
    expect(walked.pos.x).toBeCloseTo(160)
    expect(walked.pos.z).toBeCloseTo(164)
    const ran = run(walker(start), { forward: 1, run: true }, 1, openCity)
    expect(ran.pos.z).toBeCloseTo(167)
    const turned = run(walker(start), { forward: 1, cameraYaw: Math.PI / 2 }, 1, openCity)
    expect(turned.pos.x).toBeCloseTo(164)
    expect(turned.pos.z).toBeCloseTo(160)
    const strafe = run(walker(start), { right: 1 }, 1, openCity)
    expect(strafe.pos.x).toBeCloseTo(156)
    const diagonal = run(walker(start), { forward: 1, right: 1 }, 1, openCity)
    expect(dist(diagonal.pos, start)).toBeCloseTo(4)
  })

  test('[D1-2] 步行不能穿過建築物與邊界牆', () => {
    for (const home of city.homes.slice(0, 10)) {
      const inward = home.facing + Math.PI
      const yaw = inward
      const s = run(walker(home.door), { forward: 1, cameraYaw: yaw, run: true }, 3)
      expect(hitsAny(s.pos, WALK_RADIUS - 1e-6)).toBe(false)
    }
    const wall = run(walker({ x: 3, z: 84 }), { forward: 1, cameraYaw: -Math.PI / 2 }, 3)
    expect(wall.pos.x).toBeGreaterThanOrEqual(WALK_RADIUS - 1e-6)

    for (const home of city.homes.slice(0, 10)) {
      const inward = home.facing + Math.PI
      const s = stepPlayer(walker(home.door), { ...IDLE, forward: 1, run: true, cameraYaw: inward }, 4, city)
      const moved = (s.pos.x - home.door.x) * Math.sin(inward) + (s.pos.z - home.door.z) * Math.cos(inward)
      expect(moved).toBeLessThan(1)
    }
    const far = stepPlayer(walker({ x: 3, z: 84 }), { ...IDLE, forward: 1, run: true, cameraYaw: -Math.PI / 2 }, 2, city)
    expect(far.pos.x).toBeGreaterThanOrEqual(WALK_RADIUS - 1e-6)
  })

  test('開局時計程車靠邊停在車道內，角色站在旁邊人行道上且可直接上車', () => {
    for (const seed of [3, 9, 20261009]) {
      const map = generateCity(seed)
      const p = createPlayer(map)
      const offCenter = (pos: Vec2) =>
        Math.min(...map.roads.map((r) => Math.abs((r.axis === 'ew' ? pos.z : pos.x) - r.center)))
      expect(offCenter(p.pos)).toBeGreaterThanOrEqual(ROAD_WIDTH / 2 - SIDEWALK)
      expect(isOnRoad(map, p.pos)).toBe(true)
      expect(map.colliders.some((rect) => circleHitsRect(p.pos, WALK_RADIUS, rect))).toBe(false)
      expect(offCenter(p.car.pos)).toBeLessThanOrEqual(ROAD_WIDTH / 2 - SIDEWALK - 1)
      expect(dist(p.pos, p.car.pos)).toBeGreaterThanOrEqual(CAR_RADIUS + WALK_RADIUS)
      expect(enterCar(p)?.mode).toBe('drive')
    }
  })
})

describe('D2 上下車', () => {
  test('[D2-1] 距自己的車 3 m 內按 E 上車，超過 3 m 不會上車', () => {
    const base = createPlayer(city)
    const near = { ...base, mode: 'walk' as const, pos: { x: base.car.pos.x + ENTER_CAR_DISTANCE - 0.1, z: base.car.pos.z } }
    const far = { ...base, mode: 'walk' as const, pos: { x: base.car.pos.x + ENTER_CAR_DISTANCE + 0.1, z: base.car.pos.z } }
    expect(enterCar(near)?.mode).toBe('drive')
    expect(enterCar(near)?.pos).toEqual(base.car.pos)
    expect(enterCar(far)).toBeNull()
  })

  test('[D2-2] 下車後玩家位置不與任何物體重疊', () => {
    const spots = city.homes.map((h) => ({
      pos: { x: h.door.x + Math.sin(h.facing) * 4.5, z: h.door.z + Math.cos(h.facing) * 4.5 },
      heading: h.facing + Math.PI / 2,
    }))
    spots.push({ pos: { x: CAR_RADIUS + 0.05, z: 84 }, heading: Math.PI })
    for (const spot of spots) {
      const out = exitCar(driver(spot.pos, spot.heading, 0), city)
      expect(out.mode).toBe('walk')
      expect(hitsAny(out.pos, WALK_RADIUS)).toBe(false)
      expect(dist(out.pos, out.car.pos)).toBeGreaterThanOrEqual(CAR_RADIUS + WALK_RADIUS)
    }
  })

  test('[D2-3] 按 Q 車子出現在離玩家最近的路面上', () => {
    for (const home of city.homes.slice(0, 15)) {
      const called = callCar(walker(home.door), city)
      expect(isOnRoad(city, called.car.pos)).toBe(true)
      expect(isAxisAligned(called.car.heading)).toBe(true)
      expect(called.car.speed).toBe(0)
      expectOnNearestLane(called.car.pos, called.car.heading, home.door)
    }
    for (const p of [{ x: 8.3, z: 8.1 }, { x: 160, z: 160 }, { x: 3, z: 310 }]) {
      const called = callCar(walker(p), city)
      expectOnNearestLane(called.car.pos, called.car.heading, p)
    }
  })
})

describe('D3 開車', () => {
  test('[D3-1] 按住 W 加速，速度不超過 22 m/s', () => {
    const s = run(driver({ x: 0, z: 0 }, 0, 0), { forward: 1 }, 10, openCity)
    expect(s.car.speed).toBeCloseTo(MAX_SPEED)
    expect(MAX_SPEED).toBe(22)
    expect(s.pos).toEqual(s.car.pos)
  })

  test('[D3-2] 按 S 先煞停再倒車，倒車不超過 6 m/s', () => {
    let s = driver({ x: 0, z: 0 }, 0, 10)
    let sawStop = false
    for (let n = 0; n < 1200; n++) {
      const prev = s.car.speed
      s = stepPlayer(s, { ...IDLE, forward: -1 }, FINE_DT, openCity)
      expect(s.car.speed).toBeLessThanOrEqual(prev + 1e-9)
      if (s.car.speed === 0) sawStop = true
    }
    expect(sawStop).toBe(true)
    expect(s.car.speed).toBeCloseTo(-MAX_REVERSE)
    expect(MAX_REVERSE).toBe(6)
  })

  test('[D3-3] 靜止時按 A/D 車頭方向不變，行進時會轉向', () => {
    const still = run(driver({ x: 0, z: 0 }, 0.3, 0), { right: -1 }, 1, openCity)
    expect(still.car.heading).toBe(0.3)
    const left = run(driver({ x: 0, z: 0 }, 0, 10), { right: -1, forward: 1 }, 0.5, openCity)
    expect(left.car.heading).toBeGreaterThan(0)
    const right = run(driver({ x: 0, z: 0 }, 0, 10), { right: 1, forward: 1 }, 0.5, openCity)
    expect(right.car.heading).toBeLessThan(0)
  })

  test('[D3-4] Space 手煞車使車子比放開油門減速更快', () => {
    const coast = run(driver({ x: 0, z: 0 }, 0, 15), {}, 1, openCity)
    const hand = run(driver({ x: 0, z: 0 }, 0, 15), { handbrake: true }, 1, openCity)
    expect(hand.car.speed).toBeLessThan(coast.car.speed)
    expect(coast.car.speed).toBeLessThan(15)
  })
})

describe('D4 碰撞', () => {
  test('[D4-1] 撞建築物或邊界牆後車子被推回物體外，速度變為反向 30%', () => {
    const wall = stepPlayer(driver({ x: CAR_RADIUS + 0.05, z: 84 }, -Math.PI / 2, 10), IDLE, FINE_DT, city)
    expect(wall.car.pos.x).toBeGreaterThanOrEqual(CAR_RADIUS - 1e-6)
    expect(wall.car.speed).toBeCloseTo(-3, 1)

    const lag = stepPlayer(driver({ x: 20, z: 84 }, -Math.PI / 2, MAX_SPEED), { ...IDLE, forward: 1 }, 1, city)
    expect(lag.car.pos.x).toBeGreaterThanOrEqual(CAR_RADIUS - 1e-6)
    expect(lag.car.speed).toBeLessThan(0)

    const home = city.homes[0]!
    const front = { x: home.door.x + Math.sin(home.facing) * 3, z: home.door.z + Math.cos(home.facing) * 3 }
    let s = driver(front, home.facing + Math.PI, 8)
    for (let n = 0; n < 30 && s.car.speed > 0; n++) s = stepPlayer(s, IDLE, DT, city)
    expect(s.car.speed).toBeLessThan(0)
    expect(hitsAny(s.car.pos, CAR_RADIUS - 1e-6)).toBe(false)
  })

  test('[D4-2] 撞 NPC 車時玩家的車反彈', () => {
    const npc = { pos: { x: 0, z: 4 }, radius: 1.2 }
    let s = driver({ x: 0, z: 0 }, 0, 10)
    for (let n = 0; n < 30 && s.car.speed > 0; n++) s = stepPlayer(s, IDLE, DT, openCity, [npc])
    expect(s.car.speed).toBeLessThan(0)
    expect(dist(s.car.pos, npc.pos)).toBeGreaterThanOrEqual(CAR_RADIUS + npc.radius - 1e-6)
  })

  test('[D4-3] 按 R 車子移到最近的路面且朝向與道路平行', () => {
    const park = city.blocks.find((b) => b.kind === 'park')!
    const inside = { x: (park.rect.minX + park.rect.maxX) / 2, z: (park.rect.minZ + park.rect.maxZ) / 2 }
    const reset = resetCar(driver(inside, 1.1, 5), city)
    expect(isOnRoad(city, reset.car.pos)).toBe(true)
    expect(isAxisAligned(reset.car.heading)).toBe(true)
    expect(reset.car.speed).toBe(0)
    expect(reset.pos).toEqual(reset.car.pos)
    expect(hitsAny(reset.car.pos, CAR_RADIUS)).toBe(false)
    expectOnNearestLane(reset.car.pos, reset.car.heading, inside)
    for (const p of [{ x: 84, z: 84 }, { x: 50, z: 121 }]) {
      const r = resetCar(driver(p, 0.4, 3), city)
      expectOnNearestLane(r.car.pos, r.car.heading, p)
    }
  })
})

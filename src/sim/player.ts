import { CAR_LANE_OFFSET, ROAD_WIDTH, SIDEWALK, nearestRoadPose } from './city'
import { isFree, resolveCircle, type Circle } from './collide'
import type { CityMap, Vec2 } from './types'

export const WALK_SPEED = 4
export const RUN_SPEED = 7
export const WALK_RADIUS = 0.35
export const CAR_RADIUS = 1.6
export const ENTER_CAR_DISTANCE = 3
export const MAX_SPEED = 22
export const MAX_REVERSE = 6
const ACCEL = 7
const BRAKE = 14
const REVERSE_ACCEL = 4
const DRAG = 2.5
const HANDBRAKE = 20
const TURN_RATE = 1.7
/** 低於這個速度時轉向率依速度線性縮小，靜止時為 0 */
const FULL_TURN_SPEED = 6
const BOUNCE = 0.3
const EXIT_OFFSET = CAR_RADIUS + WALK_RADIUS + 0.4
/** 每個子步的最大位移（公尺），小於最薄碰撞物的一半加上角色半徑，所以不會穿過物體 */
const MAX_SUBSTEP_MOVE = 0.25
/** 開局時計程車從汽車道往路邊移的距離：車身中線離人行道 1 m */
const SPAWN_CAR_SHIFT = ROAD_WIDTH / 2 - SIDEWALK - 1 - CAR_LANE_OFFSET
/** 開局時角色從汽車道往路邊移的距離：站在人行道中線 */
const SPAWN_WALKER_SHIFT = ROAD_WIDTH / 2 - SIDEWALK / 2 - CAR_LANE_OFFSET

export type Location = { kind: 'outdoor' } | { kind: 'home'; homeId: string }

export interface CarState {
  pos: Vec2
  heading: number
  speed: number
}

export interface PlayerState {
  mode: 'walk' | 'drive'
  pos: Vec2
  heading: number
  car: CarState
  location: Location
  odometer: number
}

/** forward：W = 1、S = -1；right：D = 1、A = -1；cameraYaw：相機看出去的朝向 */
export interface PlayerInput {
  forward: number
  right: number
  run: boolean
  handbrake: boolean
  cameraYaw: number
}

export function createPlayer(city: CityMap): PlayerState {
  const lane = nearestRoadPose(city, { x: city.size / 2 - 30, z: city.size / 2 })
  const curbSide = lane.heading - Math.PI / 2
  const towardCurb = (d: number) => ({
    x: lane.pos.x + Math.sin(curbSide) * d,
    z: lane.pos.z + Math.cos(curbSide) * d,
  })
  return {
    mode: 'walk',
    pos: towardCurb(SPAWN_WALKER_SHIFT),
    heading: lane.heading,
    car: { pos: towardCurb(SPAWN_CAR_SHIFT), heading: lane.heading, speed: 0 },
    location: { kind: 'outdoor' },
    odometer: 0,
  }
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function stepWalk(state: PlayerState, input: PlayerInput, dt: number, colliders: CityMap['colliders']): PlayerState {
  const fx = Math.sin(input.cameraYaw)
  const fz = Math.cos(input.cameraYaw)
  let mx = fx * input.forward - fz * input.right
  let mz = fz * input.forward + fx * input.right
  const len = Math.hypot(mx, mz)
  if (len === 0) return state
  mx /= len
  mz /= len
  const speed = input.run ? RUN_SPEED : WALK_SPEED
  const target = { x: state.pos.x + mx * speed * dt, z: state.pos.z + mz * speed * dt }
  const { pos } = resolveCircle(target, WALK_RADIUS, colliders)
  return { ...state, pos, heading: Math.atan2(mx, mz) }
}

function nextSpeed(speed: number, input: PlayerInput, dt: number): number {
  const toward = (v: number, target: number, rate: number) =>
    v > target ? Math.max(target, v - rate * dt) : Math.min(target, v + rate * dt)
  if (input.handbrake) return toward(speed, 0, HANDBRAKE)
  if (input.forward > 0) {
    return speed < 0 ? toward(speed, 0, BRAKE) : Math.min(MAX_SPEED, speed + ACCEL * dt)
  }
  if (input.forward < 0) {
    return speed > 0 ? toward(speed, 0, BRAKE) : Math.max(-MAX_REVERSE, speed - REVERSE_ACCEL * dt)
  }
  return toward(speed, 0, DRAG)
}

function stepDrive(state: PlayerState, input: PlayerInput, dt: number, city: CityMap, obstacles: readonly Circle[]): PlayerState {
  const speed = nextSpeed(state.car.speed, input, dt)
  const grip = Math.min(1, Math.abs(speed) / FULL_TURN_SPEED) * Math.sign(speed)
  const heading = state.car.heading - input.right * TURN_RATE * grip * dt
  const target = {
    x: state.car.pos.x + Math.sin(heading) * speed * dt,
    z: state.car.pos.z + Math.cos(heading) * speed * dt,
  }
  const { pos, hit } = resolveCircle(target, CAR_RADIUS, city.colliders, obstacles)
  const car = { pos, heading, speed: hit ? -speed * BOUNCE : speed }
  return {
    ...state,
    pos,
    heading,
    car,
    odometer: state.odometer + distance(state.car.pos, pos),
  }
}

/** 推進 dt 秒，依最大位移切成子步；室內時 colliders 由呼叫端換成室內的 */
export function stepPlayer(
  state: PlayerState,
  input: PlayerInput,
  dt: number,
  city: CityMap,
  obstacles: readonly Circle[] = [],
): PlayerState {
  const maxMove = (state.mode === 'drive' ? MAX_SPEED : RUN_SPEED) * dt
  const count = Math.max(1, Math.ceil(maxMove / MAX_SUBSTEP_MOVE))
  const sub = dt / count
  let s = state
  for (let k = 0; k < count; k++) {
    s = s.mode === 'drive' ? stepDrive(s, input, sub, city, obstacles) : stepWalk(s, input, sub, city.colliders)
  }
  return s
}

export function canEnterCar(state: PlayerState): boolean {
  return state.mode === 'walk' && state.location.kind === 'outdoor' && distance(state.pos, state.car.pos) <= ENTER_CAR_DISTANCE
}

export function enterCar(state: PlayerState): PlayerState | null {
  if (!canEnterCar(state)) return null
  return { ...state, mode: 'drive', pos: state.car.pos, heading: state.car.heading }
}

/** 依序試車子左、右、後、前，取第一個不會卡進物體的位置 */
export function exitCar(state: PlayerState, city: CityMap): PlayerState {
  const h = state.car.heading
  const car: Circle = { pos: state.car.pos, radius: CAR_RADIUS }
  const angles = [h + Math.PI / 2, h - Math.PI / 2, h + Math.PI, h]
  for (const extra of [0, 1, 2]) {
    for (const a of angles) {
      const d = EXIT_OFFSET + extra
      const pos = { x: state.car.pos.x + Math.sin(a) * d, z: state.car.pos.z + Math.cos(a) * d }
      if (isFree(pos, WALK_RADIUS, city.colliders, [car])) {
        return { ...state, mode: 'walk', pos, heading: h, car: { ...state.car, speed: 0 } }
      }
    }
  }
  const { pos } = resolveCircle(state.car.pos, WALK_RADIUS, city.colliders, [car])
  return { ...state, mode: 'walk', pos, car: { ...state.car, speed: 0 } }
}

export function callCar(state: PlayerState, city: CityMap): PlayerState {
  const pose = nearestRoadPose(city, state.pos)
  return { ...state, car: { pos: pose.pos, heading: pose.heading, speed: 0 } }
}

export function resetCar(state: PlayerState, city: CityMap): PlayerState {
  const pose = nearestRoadPose(city, state.car.pos)
  const car = { pos: pose.pos, heading: pose.heading, speed: 0 }
  return state.mode === 'drive' ? { ...state, car, pos: pose.pos, heading: pose.heading } : { ...state, car }
}

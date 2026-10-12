import { CAR_LANE_OFFSET, ROAD_WIDTH, SIDEWALK, nearestRoadPose } from './city'
import { isFree, resolveCircle, type Circle } from './collide'
import type { CityMap, Pose, Vec2 } from './types'
import { BIKE_SPEC, CAR_SPEC, moveVehicle, substeps, type VehicleState } from './vehicle'

export const WALK_SPEED = 4
export const RUN_SPEED = 7
export const WALK_RADIUS = 0.35
export const CAR_RADIUS = CAR_SPEC.radius
export const ENTER_CAR_DISTANCE = 3
export const MAX_SPEED = CAR_SPEC.maxSpeed
export const MAX_REVERSE = CAR_SPEC.maxReverse
/** 下車位置與車身之間的空隙 */
const EXIT_GAP = 0.4
/** 開局時計程車從汽車道往路邊移的距離：車身中線離人行道 1 m */
const SPAWN_CAR_SHIFT = ROAD_WIDTH / 2 - SIDEWALK - 1 - CAR_LANE_OFFSET
/** 開局時角色從汽車道往路邊移的距離：站在人行道中線 */
const SPAWN_WALKER_SHIFT = ROAD_WIDTH / 2 - SIDEWALK / 2 - CAR_LANE_OFFSET

export type Location = { kind: 'outdoor' } | { kind: 'home'; homeId: string }

export type CarState = VehicleState

/** drive 時 pos／heading 跟著 car，bike 時跟著 bike；bike 為 null 表示還沒有腳踏車 */
export interface PlayerState {
  mode: 'walk' | 'drive' | 'bike'
  pos: Vec2
  heading: number
  car: CarState
  bike: VehicleState | null
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
    bike: null,
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

function stepDrive(state: PlayerState, input: PlayerInput, dt: number, city: CityMap, obstacles: readonly Circle[]): PlayerState {
  const car = moveVehicle(state.car, CAR_SPEC, input, dt, city.colliders, obstacles)
  return { ...state, pos: car.pos, heading: car.heading, car, odometer: state.odometer + distance(state.car.pos, car.pos) }
}

function stepBike(state: PlayerState, input: PlayerInput, dt: number, city: CityMap, obstacles: readonly Circle[]): PlayerState {
  if (!state.bike) return state
  const bike = moveVehicle(state.bike, BIKE_SPEC, { ...input, handbrake: false }, dt, city.colliders, obstacles)
  return { ...state, pos: bike.pos, heading: bike.heading, bike }
}

const MODE_MAX_SPEED: Record<PlayerState['mode'], number> = {
  walk: RUN_SPEED,
  drive: CAR_SPEC.maxSpeed,
  bike: BIKE_SPEC.maxSpeed,
}

/** 推進 dt 秒，依最大位移切成子步；室內時 colliders 由呼叫端換成室內的 */
export function stepPlayer(
  state: PlayerState,
  input: PlayerInput,
  dt: number,
  city: CityMap,
  obstacles: readonly Circle[] = [],
): PlayerState {
  const count = substeps(MODE_MAX_SPEED[state.mode], dt)
  const sub = dt / count
  let s = state
  for (let k = 0; k < count; k++) {
    if (s.mode === 'drive') s = stepDrive(s, input, sub, city, obstacles)
    else if (s.mode === 'bike') s = stepBike(s, input, sub, city, obstacles)
    else s = stepWalk(s, input, sub, city.colliders)
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

/** 依序試車身左、右、後、前，取第一個不會卡進物體的位置 */
function stepOff(state: PlayerState, vehicle: VehicleState, radius: number, city: CityMap): PlayerState {
  const h = vehicle.heading
  const body: Circle = { pos: vehicle.pos, radius }
  const angles = [h + Math.PI / 2, h - Math.PI / 2, h + Math.PI, h]
  for (const extra of [0, 1, 2]) {
    for (const a of angles) {
      const d = radius + WALK_RADIUS + EXIT_GAP + extra
      const pos = { x: vehicle.pos.x + Math.sin(a) * d, z: vehicle.pos.z + Math.cos(a) * d }
      if (isFree(pos, WALK_RADIUS, city.colliders, [body])) return { ...state, mode: 'walk', pos, heading: h }
    }
  }
  const { pos } = resolveCircle(vehicle.pos, WALK_RADIUS, city.colliders, [body])
  return { ...state, mode: 'walk', pos }
}

export function exitCar(state: PlayerState, city: CityMap): PlayerState {
  return { ...stepOff(state, state.car, CAR_RADIUS, city), car: { ...state.car, speed: 0 } }
}

/** 騎上腳踏車：放在指定位置、速度 0、地點設為戶外 */
export function mountBike(state: PlayerState, pose: Pose): PlayerState {
  const bike = { pos: pose.pos, heading: pose.heading, speed: 0 }
  return { ...state, mode: 'bike', pos: pose.pos, heading: pose.heading, bike, location: { kind: 'outdoor' } }
}

export function dismountBike(state: PlayerState, city: CityMap): PlayerState {
  if (state.mode !== 'bike' || !state.bike) return state
  return { ...stepOff(state, state.bike, BIKE_SPEC.radius, city), bike: { ...state.bike, speed: 0 } }
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

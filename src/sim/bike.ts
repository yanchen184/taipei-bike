import type { Circle } from './collide'
import type { Pose, Rect } from './types'
import { advanceVehicle, substeps, type DriveInput, type VehicleSpec, type VehicleState } from './vehicle'

/** 撞擊時超過這個速度就摔車（§9-2） */
export const CRASH_SPEED = 1
/** 低於這個速度腳踩地，不會晃倒 */
export const FEET_DOWN_SPEED = 1
/** 低於這個速度還按住轉向會晃（§9-11） */
export const BALANCE_SPEED = 2.5
/** 轉向量超過這個值才算硬轉 */
export const WOBBLE_STEER = 0.5
/** 連續晃這麼久就倒 */
export const WOBBLE_SECONDS = 0.8
/** 倒在地上多久才扶起 */
export const DOWN_SECONDS = 2
/** 畫面上騎車時的最大傾角（rad） */
export const MAX_LEAN = 0.6
const GRAVITY = 9.8

/** 腳踏車：車身狀態加上摔車相關的狀態 */
export interface BikeState extends VehicleState {
  /** 還要倒在地上幾秒；0 = 騎著 */
  down: number
  /** 低速硬轉已經連續晃了幾秒 */
  wobble: number
  /** 車身傾角（rad，往右為正）；倒地時為 ±π/2 */
  lean: number
}

const IDLE: DriveInput = { forward: 0, right: 0, handbrake: false }

export function restingBike(pose: Pose): BikeState {
  return { pos: pose.pos, heading: pose.heading, speed: 0, down: 0, wobble: 0, lean: 0 }
}

export function isDown(b: BikeState): boolean {
  return b.down > 0
}

function shaky(speed: number, right: number): boolean {
  return speed >= FEET_DOWN_SPEED && speed < BALANCE_SPEED && Math.abs(right) >= WOBBLE_STEER
}

function fall(state: VehicleState, lean: number): BikeState {
  return { ...state, speed: 0, down: DOWN_SECONDS, wobble: 0, lean: lean < 0 ? -Math.PI / 2 : Math.PI / 2 }
}

/** 推進一個子步：倒地時不能操作，只被推出重疊的物體；撞擊或晃太久就摔車 */
export function moveBike(
  b: BikeState,
  spec: VehicleSpec,
  input: DriveInput,
  dt: number,
  colliders: readonly Rect[],
  obstacles: readonly Circle[],
): BikeState {
  if (isDown(b)) {
    const { state } = advanceVehicle({ ...b, speed: 0 }, spec, IDLE, dt, colliders, obstacles)
    const down = Math.max(0, b.down - dt)
    return { ...state, speed: 0, down, wobble: 0, lean: down > 0 ? b.lean : 0 }
  }
  const { state, impact, yawRate } = advanceVehicle(b, spec, input, dt, colliders, obstacles)
  const lean = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, Math.atan((Math.max(0, state.speed) * yawRate) / GRAVITY)))
  if (impact !== null && Math.abs(impact) > CRASH_SPEED) return fall(state, lean)
  const wobble = shaky(state.speed, input.right) ? b.wobble + dt : 0
  if (wobble >= WOBBLE_SECONDS - 1e-9) return fall(state, input.right)
  return { ...state, down: 0, wobble, lean }
}

/** 推進 dt 秒，依最大位移切成子步 */
export function stepBike(
  b: BikeState,
  spec: VehicleSpec,
  input: DriveInput,
  dt: number,
  colliders: readonly Rect[],
  obstacles: readonly Circle[],
): BikeState {
  const count = substeps(spec.maxSpeed, dt)
  let s = b
  for (let k = 0; k < count; k++) s = moveBike(s, spec, input, dt / count, colliders, obstacles)
  return s
}

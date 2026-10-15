import { resolveCircle, type Circle } from './collide'
import type { Rect, Vec2 } from './types'

export interface VehicleState {
  pos: Vec2
  heading: number
  speed: number
}

export interface VehicleSpec {
  radius: number
  maxSpeed: number
  maxReverse: number
  accel: number
  brake: number
  reverseAccel: number
  drag: number
  handbrake: number
  turnRate: number
  /** 低於這個速度時轉向率依速度線性縮小，靜止時為 0 */
  fullTurnSpeed: number
  /** 過彎：高於這個速度時轉向率乘上「過彎 ÷ 速度」；沒有時不限制（汽車） */
  corner?: number
}

/** forward：W = 1、S = -1；right：D = 1、A = -1 */
export interface DriveInput {
  forward: number
  right: number
  handbrake: boolean
}

export const BOUNCE = 0.3
/** 每個子步的最大位移（公尺），小於最薄碰撞物的一半加上角色半徑，所以不會穿過物體 */
export const MAX_SUBSTEP_MOVE = 0.25

export const CAR_SPEC: VehicleSpec = {
  radius: 1.6,
  maxSpeed: 22,
  maxReverse: 6,
  accel: 7,
  brake: 14,
  reverseAccel: 4,
  drag: 2.5,
  handbrake: 20,
  turnRate: 1.7,
  fullTurnSpeed: 6,
}

/** 沒有任何加成時的腳踏車（§12-5 基準）；比賽時依組裝換掉極速、加速、過彎、煞車 */
export const BIKE_SPEC: VehicleSpec = {
  radius: 0.6,
  maxSpeed: 12,
  maxReverse: 3,
  accel: 3,
  brake: 10,
  reverseAccel: 2,
  drag: 1,
  handbrake: 10,
  turnRate: 2.2,
  fullTurnSpeed: 3,
  corner: 6,
}

function nextSpeed(speed: number, spec: VehicleSpec, input: DriveInput, dt: number): number {
  const toward = (v: number, target: number, rate: number) =>
    v > target ? Math.max(target, v - rate * dt) : Math.min(target, v + rate * dt)
  if (input.handbrake) return toward(speed, 0, spec.handbrake)
  if (input.forward > 0) {
    return speed < 0 ? toward(speed, 0, spec.brake) : Math.min(spec.maxSpeed, speed + spec.accel * dt)
  }
  if (input.forward < 0) {
    return speed > 0 ? toward(speed, 0, spec.brake) : Math.max(-spec.maxReverse, speed - spec.reverseAccel * dt)
  }
  return toward(speed, 0, spec.drag)
}

/** 推進一個子步；呼叫端負責讓 maxSpeed × dt 不超過 MAX_SUBSTEP_MOVE */
export function moveVehicle(
  v: VehicleState,
  spec: VehicleSpec,
  input: DriveInput,
  dt: number,
  colliders: readonly Rect[],
  obstacles: readonly Circle[],
): VehicleState {
  const speed = nextSpeed(v.speed, spec, input, dt)
  const fast = spec.corner !== undefined && Math.abs(speed) > spec.corner ? spec.corner / Math.abs(speed) : 1
  const grip = Math.min(1, Math.abs(speed) / spec.fullTurnSpeed) * Math.sign(speed) * fast
  const heading = v.heading - input.right * spec.turnRate * grip * dt
  const target = { x: v.pos.x + Math.sin(heading) * speed * dt, z: v.pos.z + Math.cos(heading) * speed * dt }
  const { pos, hit } = resolveCircle(target, spec.radius, colliders, obstacles)
  return { pos, heading, speed: hit ? -speed * BOUNCE : speed }
}

export function substeps(maxSpeed: number, dt: number): number {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError(`dt 必須是非負有限數：${dt}`)
  if (!Number.isFinite(maxSpeed) || maxSpeed < 0) throw new RangeError(`maxSpeed 必須是非負有限數：${maxSpeed}`)
  return Math.max(1, Math.ceil((maxSpeed * dt) / MAX_SUBSTEP_MOVE))
}

/** 推進 dt 秒，依最大位移切成子步 */
export function stepVehicle(
  v: VehicleState,
  spec: VehicleSpec,
  input: DriveInput,
  dt: number,
  colliders: readonly Rect[],
  obstacles: readonly Circle[],
): VehicleState {
  const count = substeps(spec.maxSpeed, dt)
  let s = v
  for (let k = 0; k < count; k++) s = moveVehicle(s, spec, input, dt / count, colliders, obstacles)
  return s
}

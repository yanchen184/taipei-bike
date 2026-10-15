import { isFree, segmentHitsRect, type Circle } from './collide'
import { ROAD_WIDTH, SIDEWALK } from './city'
import { CHECKPOINT_RADIUS, advanceCheckpoint, nodePose, type Course } from './course'
import { MAX_AI } from './race'
import { bikeSpec, type Build } from './parts'
import type { Rect, Vec2 } from './types'
import { BIKE_SPEC, stepVehicle, type DriveInput, type VehicleSpec, type VehicleState } from './vehicle'

export const AI_STEP = 1 / 30
/** 偏好的路線離路中線的距離，依序試：右側機車道離路緣 1 m、路中線 */
const LANES = [ROAD_WIDTH / 2 - SIDEWALK - 1, 0]
const LOOK_AHEAD = 12
/** 判斷路線是否被擋時，在腳踏車半徑外多留的空間 */
const LANE_MARGIN = 0.3
/** 目標點在自己前方多遠（沿路線） */
const CARROT = 6
/** 離檢查點路口多遠以內走路中線（進路口前、出路口後） */
const CHECKPOINT_APPROACH = 20
const CHECKPOINT_EXIT = 10
const CHECKPOINT_EXIT_LANES = [0, 3]
/** 出彎後多遠以內改瞄靠內的路線：出彎會甩寬約 1.5 m，瞄路邊會甩上人行道 */
const TURN_EXIT = 10
const TURN_EXIT_LANES = [3, 0]
/** 車頭與目標方向差超過這個角度（轉彎、換車道）就不加速，免得速度太快甩寬 */
const EXIT_ALIGN = 0.35
const STEER_GAIN = 2.5
const STUCK_DISTANCE = 3
const STUCK_SECONDS = 3
/** 完賽後停到終點後方人行道：離路口中心多遠開始停、每台間隔多遠、停車速度 */
const PARK_LATERAL = ROAD_WIDTH / 2 - SIDEWALK / 2
const PARK_START = CHECKPOINT_RADIUS + 4
const PARK_GAP = 2.4
const PARK_SPEED = 5
const PARK_ARRIVE = 0.4

export interface AiRider {
  bike: VehicleState
  /** 下一個要去的 nodes 索引 */
  wp: number
  /** 已通過的檢查點數 */
  cp: number
  /** 卡住判定的參考點 */
  anchor: Vec2
  /** 離 anchor 不到 3 m 的累計秒數 */
  still: number
  fin: boolean
}

/** 騎法（§10-2）：直線踩到極速的幾成、過彎半徑、彎前用幾成煞車力減速、提早幾公尺開始減速 */
export interface AiStyle {
  pedal: number
  radius: number
  brake: number
  margin: number
}

/** AI 1（k = 0）最弱，AI 5 最強 */
export const AI_STYLES: readonly AiStyle[] = [
  { pedal: 0.8, radius: 3.5, brake: 0.4, margin: 10 },
  { pedal: 0.85, radius: 4, brake: 0.5, margin: 8 },
  { pedal: 0.9, radius: 4.5, brake: 0.6, margin: 6 },
  { pedal: 0.95, radius: 5, brake: 0.7, margin: 4 },
  { pedal: 1, radius: 5.5, brake: 0.8, margin: 2 },
]

/** 一台 AI 的編號（決定停車位與騎法）與組裝出來的腳踏車 */
export interface AiDriver {
  k: number
  spec: VehicleSpec
  style: AiStyle
}

export function aiStyle(k: number): AiStyle {
  const style = AI_STYLES[k]
  if (!style) throw new RangeError(`AI 編號必須是 0 到 ${MAX_AI - 1}：${k}`)
  return style
}

export function aiDriver(k: number, build: Build): AiDriver {
  return { k, spec: bikeSpec(build), style: aiStyle(k) }
}

/** 直線上踩到的速度 */
export function cruiseSpeed(spec: VehicleSpec, style: AiStyle): number {
  return spec.maxSpeed * style.pedal
}

/** 用全轉向以 style.radius 半徑過彎的速度：過彎值以下半徑 = 速度 ÷ 轉向率，以上半徑 = 速度² ÷（轉向率 × 過彎）；不超過直線速度 */
export function turnSpeed(spec: VehicleSpec, style: AiStyle): number {
  const corner = spec.corner ?? spec.maxSpeed
  const slow = spec.turnRate * style.radius
  const v = slow <= corner ? slow : Math.sqrt(spec.turnRate * corner * style.radius)
  return Math.min(v, cruiseSpeed(spec, style))
}

/** 離轉彎點 distance 公尺時最多騎多快，才能用自己的減速度在轉彎點降到過彎速度 */
export function approachSpeed(spec: VehicleSpec, style: AiStyle, distance: number): number {
  const vt = turnSpeed(spec, style)
  const room = Math.max(0, distance - style.margin)
  return Math.sqrt(vt * vt + 2 * spec.brake * style.brake * room)
}

export function createAi(course: Course, slot: number): AiRider {
  const pose = course.grid[slot]!
  return { bike: { pos: pose.pos, heading: pose.heading, speed: 0 }, wp: 1, cp: 0, anchor: pose.pos, still: 0, fin: false }
}

interface Leg {
  from: Vec2
  dir: Vec2
  right: Vec2
  length: number
}

function leg(course: Course, wp: number): Leg {
  const from = course.nodes[wp - 1]!
  const to = course.nodes[wp]!
  const length = Math.hypot(to.x - from.x, to.z - from.z)
  const dir = { x: (to.x - from.x) / length, z: (to.z - from.z) / length }
  return { from, dir, right: { x: -dir.z, z: dir.x }, length }
}

function onLane(l: Leg, along: number, lane: number): Vec2 {
  return { x: l.from.x + l.dir.x * along + l.right.x * lane, z: l.from.z + l.dir.z * along + l.right.z * lane }
}

function alongOf(l: Leg, p: Vec2): number {
  return (p.x - l.from.x) * l.dir.x + (p.z - l.from.z) * l.dir.z
}

/** 這一段與下一段路線的交點在這一段上的位置：右轉提早、左轉延後 lane 公尺 */
function turnAlong(course: Course, wp: number, lane: number): number {
  const here = leg(course, wp)
  if (wp + 1 >= course.nodes.length) return here.length
  const next = leg(course, wp + 1)
  return here.length + lane * (next.right.x * here.dir.x + next.right.z * here.dir.z)
}

/** 到 nodes[wp] 之後是否要轉彎 */
function isTurn(course: Course, wp: number): boolean {
  if (wp + 1 >= course.nodes.length) return false
  const here = leg(course, wp)
  const next = leg(course, wp + 1)
  return here.dir.x !== next.dir.x || here.dir.z !== next.dir.z
}

function laneBlocked(a: Vec2, b: Vec2, colliders: readonly Rect[], obstacles: readonly Circle[]): boolean {
  const clearance = BIKE_SPEC.radius + LANE_MARGIN
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  for (const c of obstacles) {
    const t = Math.max(0, Math.min(1, ((c.pos.x - a.x) * dx + (c.pos.z - a.z) * dz) / len2))
    if (Math.hypot(a.x + dx * t - c.pos.x, a.z + dz * t - c.pos.z) < c.radius + clearance) return true
  }
  return colliders.some((r) =>
    segmentHitsRect(a, b, { minX: r.minX - clearance, minZ: r.minZ - clearance, maxX: r.maxX + clearance, maxZ: r.maxZ + clearance }),
  )
}

/** 依序挑第一條沒被擋的路線；全被擋時挑沒有固定障礙物（捷運柱子等）的那條，在車陣後面等車開走 */
function chooseLane(l: Leg, along: number, lanes: readonly number[], colliders: readonly Rect[], obstacles: readonly Circle[]): number {
  const free = (lane: number, circles: readonly Circle[]) => !laneBlocked(onLane(l, along + 1, lane), onLane(l, along + LOOK_AHEAD, lane), colliders, circles)
  return lanes.find((lane) => free(lane, obstacles)) ?? lanes.find((lane) => free(lane, [])) ?? lanes[0]!
}

function isCheckpointNode(course: Course, index: number): boolean {
  return course.checkpoints.includes(index)
}

/** 檢查點路口前後改走路中線，確保經過檢查點 8 m 內；出路口時中線被柱子擋住就走靠內的車道 */
function laneFor(course: Course, wp: number, l: Leg, along: number, colliders: readonly Rect[], obstacles: readonly Circle[]): number {
  if (isCheckpointNode(course, wp) && l.length - along < CHECKPOINT_APPROACH) return 0
  if (isCheckpointNode(course, wp - 1) && along < CHECKPOINT_EXIT) return chooseLane(l, along, CHECKPOINT_EXIT_LANES, colliders, obstacles)
  const exiting = wp >= 2 && isTurn(course, wp - 1) && along < TURN_EXIT
  return chooseLane(l, along, exiting ? TURN_EXIT_LANES : LANES, colliders, obstacles)
}

/** 這一段結束時走的路線：終點是檢查點時為路中線 */
function endLane(course: Course, wp: number, lane: number): number {
  return isCheckpointNode(course, wp) ? 0 : lane
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

function throttle(speed: number, target: number): number {
  if (speed < target - 0.2) return 1
  if (speed > target + 0.5) return -1
  return 0
}

function respawn(ai: AiRider, course: Course): AiRider {
  const pose = nodePose(course, ai.wp - 1)
  return { ...ai, bike: { pos: pose.pos, heading: pose.heading, speed: 0 }, anchor: pose.pos, still: 0 }
}

/** 選手的碰撞圓；已完賽的選手不參與碰撞 */
export function riderCircles(riders: readonly { pos: Vec2; fin: boolean }[]): Circle[] {
  return riders.filter((r) => !r.fin).map((r) => ({ pos: r.pos, radius: BIKE_SPEC.radius }))
}

const parkCache = new WeakMap<Course, readonly Vec2[]>()

/** 第 k 台 AI 完賽後的停車位：終點路口往直走、右轉、左轉方向的右側人行道，挑第一個整排都沒擋到的方向 */
export function parkSlot(course: Course, k: number, colliders: readonly Rect[]): Vec2 {
  let slots = parkCache.get(course)
  if (!slots) {
    const last = course.nodes.length - 1
    const end = course.nodes[last]!
    const { dir } = leg(course, last)
    const dirs = [dir, { x: -dir.z, z: dir.x }, { x: dir.z, z: -dir.x }]
    const row = (d: Vec2) =>
      Array.from({ length: MAX_AI }, (_, i) => {
        const along = PARK_START + i * PARK_GAP
        return { x: end.x + d.x * along - d.z * PARK_LATERAL, z: end.z + d.z * along + d.x * PARK_LATERAL }
      })
    slots = dirs.map(row).find((r) => r.every((p) => isFree(p, BIKE_SPEC.radius, colliders))) ?? row(dir)
    parkCache.set(course, slots)
  }
  return slots[k]!
}

/** 完賽後慢慢騎到自己的停車位停好；不與其他選手碰撞，只避開建築 */
function park(ai: AiRider, driver: AiDriver, course: Course, dt: number, colliders: readonly Rect[]): AiRider {
  const slot = parkSlot(course, driver.k, colliders)
  const { pos, heading, speed } = ai.bike
  const distance = Math.hypot(slot.x - pos.x, slot.z - pos.z)
  if (distance < PARK_ARRIVE) return speed === 0 ? ai : { ...ai, bike: { ...ai.bike, speed: 0 } }
  const error = wrapAngle(Math.atan2(slot.x - pos.x, slot.z - pos.z) - heading)
  const input: DriveInput = {
    forward: throttle(speed, Math.min(PARK_SPEED, distance)),
    right: Math.max(-1, Math.min(1, -error * STEER_GAIN)),
    handbrake: false,
  }
  return { ...ai, bike: stepVehicle(ai.bike, driver.spec, input, dt, colliders, []) }
}

/** 推進 dt 秒（固定用 AI_STEP），用 driver 的組裝與騎法；obstacles 是其他選手、其他 AI 與 NPC 車 */
export function stepAi(
  ai: AiRider,
  driver: AiDriver,
  course: Course,
  dt: number,
  colliders: readonly Rect[],
  obstacles: readonly Circle[],
): AiRider {
  if (ai.fin) return park(ai, driver, course, dt, colliders)
  const { spec, style } = driver
  let wp = ai.wp
  let l = leg(course, wp)
  let along = alongOf(l, ai.bike.pos)
  let lane = laneFor(course, wp, l, along, colliders, obstacles)
  // 離轉彎點一個過彎半徑時切到下一段，弧線才會剛好接上下一段；太晚切會甩出路外（城市邊緣直接撞牆）
  if (wp + 1 < course.nodes.length && along >= turnAlong(course, wp, endLane(course, wp, lane)) - style.radius) {
    wp += 1
    l = leg(course, wp)
    along = alongOf(l, ai.bike.pos)
    lane = laneFor(course, wp, l, along, colliders, obstacles)
  }

  const end = turnAlong(course, wp, endLane(course, wp, lane))
  const target = onLane(l, Math.min(Math.max(along, 0) + CARROT, end), lane)
  const { pos, heading, speed } = ai.bike
  const error = wrapAngle(Math.atan2(target.x - pos.x, target.z - pos.z) - heading)
  const ahead = isTurn(course, wp) ? approachSpeed(spec, style, end - along) : Infinity
  const turning = Math.abs(error) > EXIT_ALIGN ? turnSpeed(spec, style) : Infinity
  const input: DriveInput = {
    forward: throttle(speed, Math.min(cruiseSpeed(spec, style), ahead, turning)),
    right: Math.max(-1, Math.min(1, -error * STEER_GAIN)),
    handbrake: false,
  }
  const bike = stepVehicle(ai.bike, spec, input, dt, colliders, obstacles)

  const moved = Math.hypot(bike.pos.x - ai.anchor.x, bike.pos.z - ai.anchor.z) >= STUCK_DISTANCE
  const still = moved ? 0 : ai.still + dt
  const cp = advanceCheckpoint(course, ai.cp, bike.pos)
  const next: AiRider = { bike, wp, cp, anchor: moved ? bike.pos : ai.anchor, still, fin: cp === course.checkpoints.length }
  return !next.fin && still >= STUCK_SECONDS - 1e-9 ? respawn(next, course) : next
}

import { isFree, segmentHitsRect, type Circle } from './collide'
import { ROAD_WIDTH, SIDEWALK } from './city'
import { CHECKPOINT_RADIUS, advanceCheckpoint, nodePose, type Course } from './course'
import { MAX_AI } from './race'
import { bikeSpec, type Build } from './parts'
import type { Rect, Vec2 } from './types'
import { BALANCE_SPEED, FEET_DOWN_SPEED, WOBBLE_STEER, isDown, restingBike, stepBike, type BikeState } from './bike'
import { BIKE_SPEC, stepVehicle, type DriveInput, type VehicleSpec } from './vehicle'

export const AI_STEP = 1 / 30
/** 偏好的路線離路中線的距離，依序試：路中線、右側機車道（離路緣 1 m） */
const LANES = [0, ROAD_WIDTH / 2 - SIDEWALK - 1]
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
/** 低速轉向用到晃倒門檻的幾成 */
const SAFE_STEER = 0.9
/** 預判避撞：煞車力用幾成算煞停時間，再多看幾秒 */
const STOP_BRAKE = 0.8
const STOP_SLACK = 0.3
/** 低速時車頭前這麼遠內有牆就先倒退轉向（摔車扶起後常常正對著牆）；倒退速度同 CRAWL_SPEED */
const WALL_PROBE = 1
/** 速度超過這個值（m/s）的碰撞物算是會開走的 */
const MOVING_SPEED = 1
/** 低速時車頭偏離目標超過這個角度（rad）或到目標的直線被牆擋住，就用腳踩地的速度慢慢騎，不會晃倒也不會撞到摔車 */
const CRAWL_ERROR = 0.7
const CRAWL_SPEED = 0.9 * FEET_DOWN_SPEED
const IDLE: DriveInput = { forward: 0, right: 0, handbrake: false }
const STUCK_DISTANCE = 3
const STUCK_SECONDS = 3
/** 為了不撞上前方的車煞停等待時，卡住計時只算十分之一：跟著車陣等紅燈、再跟著慢慢起步不會被當成卡住，被擋 30 秒仍會重生 */
const WAITING_RATE = 1 / 10
/** 完賽後停到終點後方人行道：離路口中心多遠開始停、每台間隔多遠、停車速度 */
const PARK_LATERAL = ROAD_WIDTH / 2 - SIDEWALK / 2
const PARK_START = CHECKPOINT_RADIUS + 4
const PARK_GAP = 2.4
const PARK_SPEED = 5
const PARK_ARRIVE = 0.4

export interface AiRider {
  bike: BikeState
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
  { pedal: 0.92, radius: 5, brake: 0.7, margin: 4 },
  { pedal: 0.94, radius: 5.5, brake: 0.75, margin: 3 },
  { pedal: 0.96, radius: 5.5, brake: 0.8, margin: 2 },
  { pedal: 0.98, radius: 6, brake: 0.85, margin: 1.5 },
  { pedal: 1, radius: 6.5, brake: 0.9, margin: 1 },
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
  return { bike: restingBike(pose), wp: 1, cp: 0, anchor: pose.pos, still: 0, fin: false }
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

/** 這條路線前方 LOOK_AHEAD 公尺內沒有東西擋住 */
function laneFree(l: Leg, along: number, lane: number, colliders: readonly Rect[], obstacles: readonly Circle[]): boolean {
  return !laneBlocked(onLane(l, along + 1, lane), onLane(l, along + LOOK_AHEAD, lane), colliders, obstacles)
}

function moving(c: Circle): boolean {
  return c.vel !== undefined && Math.hypot(c.vel.x, c.vel.z) > MOVING_SPEED
}

/**
 * 依序挑第一條沒被擋的路線；全被擋時挑只被會開走的車擋住的那條（跟在後面，不要轉回去貼著停住的選手），
 * 再不行挑沒有固定障礙物（捷運柱子等）的那條，在車陣後面等車開走
 */
function chooseLane(l: Leg, along: number, lanes: readonly number[], colliders: readonly Rect[], obstacles: readonly Circle[]): number {
  const stopped = obstacles.filter((c) => !moving(c))
  return (
    lanes.find((lane) => laneFree(l, along, lane, colliders, obstacles)) ??
    lanes.find((lane) => laneFree(l, along, lane, colliders, stopped)) ??
    lanes.find((lane) => laneFree(l, along, lane, colliders, [])) ??
    lanes[0]!
  )
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

/** 低速時轉向量壓在會晃倒的門檻以下（§9-11） */
function steer(speed: number, want: number): number {
  const limit = speed >= FEET_DOWN_SPEED && speed < BALANCE_SPEED ? WOBBLE_STEER * SAFE_STEER : 1
  return Math.max(-limit, Math.min(limit, want))
}

const STILL: Vec2 = { x: 0, z: 0 }

/** 照目前的速度朝 heading 騎，碰撞物照它的速度移動（沒有速度視為停著），多久後會撞上在自己前方的碰撞物；不會撞時為 Infinity */
function hitTime(bike: BikeState, heading: number, c: Circle): number {
  const vel = c.vel ?? STILL
  const fx = Math.sin(heading)
  const fz = Math.cos(heading)
  const px = c.pos.x - bike.pos.x
  const pz = c.pos.z - bike.pos.z
  // 停著時當成以腳踩地的速度起步，才看得出往這個方向騎會不會碰到
  const speed = Math.max(bike.speed, CRAWL_SPEED)
  const wx = vel.x - fx * speed
  const wz = vel.z - fz * speed
  const touch = c.radius + BIKE_SPEC.radius
  // 已經在留白距離內（並排超車）時只算真的碰到，不然擦身而過也會被當成擋住
  const reach = Math.hypot(px, pz) > touch + LANE_MARGIN ? touch + LANE_MARGIN : touch
  const gap = px * px + pz * pz - reach * reach
  if (gap <= 0) return px * fx + pz * fz > 0 ? 0 : Infinity
  // |p + w t| = reach 的最早非負解
  const a = wx * wx + wz * wz
  const b = px * wx + pz * wz
  if (a === 0 || b >= 0) return Infinity
  const disc = b * b - a * gap
  if (disc < 0) return Infinity
  const t = Math.max(0, (-b - Math.sqrt(disc)) / a)
  // 只管撞擊點在自己前方的：從後面或旁邊撞上來的煞車也躲不掉
  return (px + wx * t) * fx + (pz + wz * t) * fz > 0 ? t : Infinity
}

/**
 * 煞停距離內就要轉彎時，轉進下一段之後要去的方向；轉彎前先看這個方向，才不會轉過去切到並排的車。
 * 不轉彎或離轉彎點還遠時為 null
 */
function exitAim(spec: VehicleSpec, style: AiStyle, course: Course, wp: number, lane: number, bike: BikeState, toTurn: number): number | null {
  if (!isTurn(course, wp)) return null
  const braking = Math.max(0, bike.speed) ** 2 / (2 * spec.brake * STOP_BRAKE)
  if (toTurn > braking + style.radius) return null
  const next = leg(course, wp + 1)
  const target = onLane(next, Math.max(alongOf(next, bike.pos), 0) + CARROT, endLane(course, wp, lane))
  return Math.atan2(target.x - bike.pos.x, target.z - bike.pos.z)
}

/**
 * 照現在的速度煞停前會撞上前方碰撞物時限速：往要去的方向 aims 任一個也會撞時目標速度為 0（煞車等它離開），
 * 只有目前車頭會撞、要去的方向是空的時候腳踩地慢慢轉過去；都不會撞時不限制
 */
function hazardSpeed(spec: VehicleSpec, bike: BikeState, aims: readonly number[], obstacles: readonly Circle[]): number {
  const stopping = Math.max(0, bike.speed) / (spec.brake * STOP_BRAKE) + STOP_SLACK
  let ahead = Infinity
  let toward = Infinity
  for (const c of obstacles) {
    ahead = Math.min(ahead, hitTime(bike, bike.heading, c))
    for (const aim of aims) toward = Math.min(toward, hitTime(bike, aim, c))
  }
  if (toward < stopping) return 0
  return ahead < stopping ? CRAWL_SPEED : Infinity
}

function respawn(ai: AiRider, course: Course): AiRider {
  const pose = nodePose(course, ai.wp - 1)
  return { ...ai, bike: restingBike(pose), anchor: pose.pos, still: 0 }
}

/** 選手的碰撞圓；已完賽的選手不參與碰撞；知道車頭與速度時帶上速度供 AI 預判 */
export function riderCircles(riders: readonly { pos: Vec2; fin: boolean; heading?: number; speed?: number }[]): Circle[] {
  return riders
    .filter((r) => !r.fin)
    .map((r) =>
      r.heading === undefined || r.speed === undefined
        ? { pos: r.pos, radius: BIKE_SPEC.radius }
        : { pos: r.pos, radius: BIKE_SPEC.radius, vel: { x: Math.sin(r.heading) * r.speed, z: Math.cos(r.heading) * r.speed } },
    )
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
  return { ...ai, bike: { ...ai.bike, ...stepVehicle(ai.bike, driver.spec, input, dt, colliders, []), down: 0, wobble: 0, lean: 0 } }
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
  if (isDown(ai.bike)) {
    // 倒地的 2 秒不算卡住：扶起後從原地重新計時
    const bike = stepBike(ai.bike, spec, IDLE, dt, colliders, obstacles)
    return { ...ai, bike, anchor: bike.pos, still: 0 }
  }
  let wp = ai.wp
  let l = leg(course, wp)
  let along = alongOf(l, ai.bike.pos)
  let lane = laneFor(course, wp, l, along, colliders, obstacles)
  // 離轉彎點一個過彎半徑時切到下一段，弧線才會剛好接上下一段；太晚切會甩出路外（城市邊緣直接撞牆）。
  // 轉彎點用車子現在的橫向位置算：換車道換到一半就轉，照目標車道算會提早轉、切過路口的人行道
  const offset = Math.min(Math.max((ai.bike.pos.x - l.from.x) * l.right.x + (ai.bike.pos.z - l.from.z) * l.right.z, 0), endLane(course, wp, lane))
  if (wp + 1 < course.nodes.length && along >= turnAlong(course, wp, offset) - style.radius) {
    wp += 1
    l = leg(course, wp)
    along = alongOf(l, ai.bike.pos)
    lane = laneFor(course, wp, l, along, colliders, obstacles)
  }

  const end = turnAlong(course, wp, endLane(course, wp, lane))
  const target = onLane(l, Math.min(Math.max(along, 0) + CARROT, end), lane)
  const { pos, heading, speed } = ai.bike
  const aim = Math.atan2(target.x - pos.x, target.z - pos.z)
  const error = wrapAngle(aim - heading)
  const ahead = isTurn(course, wp) ? approachSpeed(spec, style, end - along) : Infinity
  const turning = Math.abs(error) > EXIT_ALIGN ? turnSpeed(spec, style) : Infinity
  const exit = exitAim(spec, style, course, wp, lane, ai.bike, end - along)
  const blocked = hazardSpeed(spec, ai.bike, exit === null ? [aim] : [aim, exit], obstacles)
  const lost = Math.abs(error) > CRAWL_ERROR || laneBlocked(pos, target, colliders, [])
  const crawl = speed < BALANCE_SPEED && lost ? CRAWL_SPEED : Infinity
  const probe = { x: pos.x + Math.sin(heading) * WALL_PROBE, z: pos.z + Math.cos(heading) * WALL_PROBE }
  // 倒退時轉向方向相反，所以 right 跟 error 同號；倒退速度壓在摔車門檻以下，撞到後面也只會彈開
  const input: DriveInput =
    speed < FEET_DOWN_SPEED && laneBlocked(pos, probe, colliders, [])
      ? { forward: speed > -CRAWL_SPEED ? -1 : 0, right: Math.max(-1, Math.min(1, error * STEER_GAIN)), handbrake: false }
      : {
          forward: throttle(speed, Math.min(cruiseSpeed(spec, style), ahead, turning, blocked, crawl)),
          right: steer(speed, -error * STEER_GAIN),
          handbrake: false,
        }
  const bike = stepBike(ai.bike, spec, input, dt, colliders, obstacles)

  const moved = Math.hypot(bike.pos.x - ai.anchor.x, bike.pos.z - ai.anchor.z) >= STUCK_DISTANCE
  const still = moved ? 0 : ai.still + (blocked === 0 ? dt * WAITING_RATE : dt)
  const cp = advanceCheckpoint(course, ai.cp, bike.pos)
  const next: AiRider = { bike, wp, cp, anchor: moved ? bike.pos : ai.anchor, still, fin: cp === course.checkpoints.length }
  return !next.fin && still >= STUCK_SECONDS - 1e-9 ? respawn(next, course) : next
}

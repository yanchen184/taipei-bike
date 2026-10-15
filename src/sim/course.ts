import { createRng, hashSeed, shuffle, type Rng } from './rng'
import type { CityMap, Intersection, Pose, Vec2 } from './types'

export const CHECKPOINT_RADIUS = 8
export const GRID_SIZE = 6
/** 每幾段放一個檢查點 */
const CHECKPOINT_EVERY = 2
const MIN_CHECKPOINTS = 6
const MAX_CHECKPOINTS = 8
/** 起跑格在路中線上離起點路口中心的距離（第 0 格最前面）；NPC 汽機車不會開進中線，8 m 以內有橫向車流 */
const GRID_ALONG = [30, 26, 22, 18, 14, 10]

export interface Course {
  n: number
  /** 依序經過的路口中心，nodes[0] 是起點 */
  nodes: Vec2[]
  /** 檢查點在 nodes 中的索引：2、4、6…，最後一個是終點 */
  checkpoints: number[]
  grid: Pose[]
}

function neighbors(city: CityMap, node: Intersection): Intersection[] {
  return city.intersections.filter((o) => Math.abs(o.i - node.i) + Math.abs(o.j - node.j) === 1)
}

/** 回溯法找一條長度為 segments、不重複經過路口的路線；第一段不走 blocked 這條南北向道路 */
function selfAvoidingWalk(city: CityMap, rng: Rng, segments: number, blocked: number): Intersection[] {
  const path: Intersection[] = []
  const used = new Set<string>()
  const extend = (node: Intersection): boolean => {
    path.push(node)
    used.add(node.id)
    if (path.length === segments + 1) return true
    for (const next of shuffle(neighbors(city, node), rng)) {
      const onBlocked = path.length === 1 && node.x === blocked && next.x === blocked
      if (!used.has(next.id) && !onBlocked && extend(next)) return true
    }
    path.pop()
    used.delete(node.id)
    return false
  }
  for (const start of shuffle(city.intersections, rng)) {
    if (extend(start)) return path
  }
  throw new Error(`no course with ${segments} segments`)
}

function unit(a: Vec2, b: Vec2): Vec2 {
  const len = Math.hypot(b.x - a.x, b.z - a.z)
  return { x: (b.x - a.x) / len, z: (b.z - a.z) / len }
}

function headingOf(d: Vec2): number {
  return Math.atan2(d.x, d.z)
}

function buildGrid(a: Vec2, b: Vec2): Pose[] {
  const d = unit(a, b)
  return GRID_ALONG.map((along) => ({ pos: { x: a.x + d.x * along, z: a.z + d.z * along }, heading: headingOf(d) }))
}

/** 同一座城（同一個 seed）與局數一定產生同一條賽道 */
export function generateCourse(city: CityMap, n: number): Course {
  const rng = createRng(hashSeed(city.seed, 7, n))
  const segments = CHECKPOINT_EVERY * rng.int(MIN_CHECKPOINTS, MAX_CHECKPOINTS)
  const mrtRoad = city.roads.find((r) => r.id === city.mrt.roadId)!
  const nodes = selfAvoidingWalk(city, rng, segments, mrtRoad.center).map((x) => ({ x: x.x, z: x.z }))
  const checkpoints = Array.from({ length: segments / CHECKPOINT_EVERY }, (_, k) => CHECKPOINT_EVERY * (k + 1))
  return { n, nodes, checkpoints, grid: buildGrid(nodes[0]!, nodes[1]!) }
}

/** 第 k 個檢查點（0 起算）的位置 */
export function checkpointPos(course: Course, k: number): Vec2 {
  return course.nodes[course.checkpoints[k]!]!
}

/** cp = 已通過的檢查點數；只看下一個檢查點 */
export function advanceCheckpoint(course: Course, cp: number, pos: Vec2): number {
  if (cp >= course.checkpoints.length) return cp
  const next = checkpointPos(course, cp)
  return Math.hypot(pos.x - next.x, pos.z - next.z) <= CHECKPOINT_RADIUS ? cp + 1 : cp
}

/** 離下一個檢查點的直線距離；已完成時為 0 */
export function distanceToNext(course: Course, cp: number, pos: Vec2): number {
  if (cp >= course.checkpoints.length) return 0
  const next = checkpointPos(course, cp)
  return Math.hypot(pos.x - next.x, pos.z - next.z)
}

/** 路口 nodes[k] 的中心，朝向下一個路口（最後一個路口朝向來的方向） */
export function nodePose(course: Course, k: number): Pose {
  const at = course.nodes[k]!
  const next = course.nodes[k + 1]
  const d = next ? unit(at, next) : unit(course.nodes[k - 1]!, at)
  return { pos: at, heading: headingOf(d) }
}

/** 按 R 的重生位置：最後通過的檢查點；還沒通過時回自己的起跑格 */
export function respawnPose(course: Course, cp: number, slot: number): Pose {
  return cp === 0 ? course.grid[slot]! : nodePose(course, course.checkpoints[cp - 1]!)
}

export type TurnKind = 'left' | 'right' | 'straight' | 'finish'

/** 路線上下一個要經過的路口 */
export interface TurnHint {
  /** 路口在 nodes 中的索引 */
  node: number
  kind: TurnKind
  /** 到路口中心的直線距離 */
  dist: number
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const d = unit(a, b)
  const length = Math.hypot(b.x - a.x, b.z - a.z)
  const u = Math.min(Math.max((p.x - a.x) * d.x + (p.z - a.z) * d.z, 0), length)
  return Math.hypot(p.x - (a.x + d.x * u), p.z - (a.z + d.z * u))
}

/** 在路口 k 要怎麼轉：前後兩段方向的叉積，正的是右轉（D 讓 heading 變小） */
function turnAt(course: Course, k: number): TurnKind {
  const [a, b, c] = [course.nodes[k - 1]!, course.nodes[k]!, course.nodes[k + 1]]
  if (!c) return 'finish'
  const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)
  if (cross === 0) return 'straight'
  return cross > 0 ? 'right' : 'left'
}

/**
 * 下一個路口：只在「上一個檢查點的前一段」到「下一個檢查點」之間找離 pos 最近的路段（一樣近取後面那段），
 * 快到檢查點時仍提示檢查點那個路口，也不會被平行的路線路段帶走；已完成時為 null
 */
export function nextTurn(course: Course, cp: number, pos: Vec2): TurnHint | null {
  if (cp >= course.checkpoints.length) return null
  const prev = cp === 0 ? 0 : course.checkpoints[cp - 1]!
  const last = course.checkpoints[cp]! - 1
  let seg = Math.max(0, prev - 1)
  for (let k = seg + 1; k <= last; k++) {
    if (segmentDistance(pos, course.nodes[k]!, course.nodes[k + 1]!) <= segmentDistance(pos, course.nodes[seg]!, course.nodes[seg + 1]!)) seg = k
  }
  const node = seg + 1
  const at = course.nodes[node]!
  return { node, kind: turnAt(course, node), dist: Math.hypot(pos.x - at.x, pos.z - at.z) }
}

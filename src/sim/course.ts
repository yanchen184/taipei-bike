import { createRng, hashSeed, shuffle, type Rng } from './rng'
import type { CityMap, Intersection, Pose, Vec2 } from './types'

export const CHECKPOINT_RADIUS = 8
export const GRID_SIZE = 6
/** 每幾段放一個檢查點 */
const CHECKPOINT_EVERY = 2
const MIN_CHECKPOINTS = 6
const MAX_CHECKPOINTS = 8
/** 起跑格每排離起點路口的距離（前排先） */
const GRID_ROWS = [14, 9, 4]
/** 起跑格兩欄離路中線的距離：右欄、左欄 */
const GRID_COLUMNS = [3, -3]

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

/** 回溯法找一條長度為 segments、不重複經過路口的路線 */
function selfAvoidingWalk(city: CityMap, rng: Rng, segments: number): Intersection[] {
  const path: Intersection[] = []
  const used = new Set<string>()
  const extend = (node: Intersection): boolean => {
    path.push(node)
    used.add(node.id)
    if (path.length === segments + 1) return true
    for (const next of shuffle(neighbors(city, node), rng)) {
      if (!used.has(next.id) && extend(next)) return true
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
  const right = { x: -d.z, z: d.x }
  const grid: Pose[] = []
  for (const along of GRID_ROWS) {
    for (const side of GRID_COLUMNS) {
      grid.push({ pos: { x: a.x + d.x * along + right.x * side, z: a.z + d.z * along + right.z * side }, heading: headingOf(d) })
    }
  }
  return grid
}

/** 同一座城（同一個 seed）與局數一定產生同一條賽道 */
export function generateCourse(city: CityMap, n: number): Course {
  const rng = createRng(hashSeed(city.seed, 7, n))
  const segments = CHECKPOINT_EVERY * rng.int(MIN_CHECKPOINTS, MAX_CHECKPOINTS)
  const nodes = selfAvoidingWalk(city, rng, segments).map((x) => ({ x: x.x, z: x.z }))
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

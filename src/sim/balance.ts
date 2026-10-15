import { aiStyle, cruiseSpeed, turnSpeed, type AiStyle } from './ai'
import type { Course } from './course'
import { LEGAL_BUILDS, bikeSpec, type Build } from './parts'
import { createRng, hashSeed } from './rng'
import type { Vec2 } from './types'
import type { VehicleSpec } from './vehicle'

/** AI 1–5 從排名前幾成的組裝中隨機挑一套；AI 5 一定挑第一名（§10-2） */
const PICK_WINDOW = [1, 0.6, 0.3, 0.12, 0]
/** 每個彎出彎修正方向多花的秒數 ÷（直線速度 − 過彎速度），由騎法模擬校正 */
const TURN_PENALTY = 0.16

/** 賽道拆成一段段直線（同方向的路段合併），回傳每段長度 */
export function straights(course: Course): number[] {
  const out: number[] = []
  let dir: Vec2 | null = null
  for (let i = 1; i < course.nodes.length; i++) {
    const d = heading(course, i)
    if (dir && dir.x === d.x && dir.z === d.z) out[out.length - 1]! += legLength(course, i)
    else out.push(legLength(course, i))
    dir = d
  }
  return out
}

function legLength(course: Course, i: number): number {
  const a = course.nodes[i - 1]!
  const b = course.nodes[i]!
  return Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z))
}

/** nodes[i - 1] → nodes[i] 的單位方向 */
function heading(course: Course, i: number): Vec2 {
  const a = course.nodes[i - 1]!
  const b = course.nodes[i]!
  const length = legLength(course, i)
  return { x: (b.x - a.x) / length, z: (b.z - a.z) / length }
}

/** 一段直線從 v0 加速到最多 vc、在終點前降到 v1 的時間；最後 margin 公尺維持 v1 */
function straightTime(length: number, v0: number, v1: number, vc: number, accel: number, brake: number, margin: number): number {
  const room = Math.max(0, length - margin)
  const hold = margin > 0 ? (length - room) / v1 : 0
  const up = (vc * vc - v0 * v0) / (2 * accel)
  const down = (vc * vc - v1 * v1) / (2 * brake)
  if (up + down <= room) return (vc - v0) / accel + (vc - v1) / brake + (room - up - down) / vc + hold
  const peak = Math.sqrt((2 * accel * brake * room + brake * v0 * v0 + accel * v1 * v1) / (accel + brake))
  return (peak - v0) / accel + (peak - v1) / brake + hold
}

/**
 * 用 AI 的騎法估計騎完賽道的秒數：直線加速到直線速度、彎前減到過彎速度，每個彎再加出彎修正的時間。
 * 只用加減乘除與開根號，所有瀏覽器算出來一樣，可以用來決定 AI 配車。
 */
export function estimateTime(course: Course, spec: VehicleSpec, style: AiStyle): number {
  const vc = cruiseSpeed(spec, style)
  const vt = turnSpeed(spec, style)
  const brake = spec.brake * style.brake
  const legs = straights(course)
  const turns = (legs.length - 1) * TURN_PENALTY * (vc - vt)
  return legs.reduce((sum, length, i) => {
    const last = i === legs.length - 1
    return sum + straightTime(length, i === 0 ? 0 : vt, last ? vc : vt, vc, spec.accel, brake, last ? 0 : style.margin)
  }, turns)
}

/** 所有合法組裝依估計時間由快到慢排序；一樣快時依零件表順序 */
export function rankBuilds(course: Course, style: AiStyle): Build[] {
  return LEGAL_BUILDS.map((build) => ({ build, time: estimateTime(course, bikeSpec(build), style) }))
    .sort((a, b) => a.time - b.time)
    .map((r) => r.build)
}

/** 第 k 台 AI 這一局的組裝，由城市 seed、局數、AI 編號決定 */
export function aiBuild(course: Course, seed: number, k: number): Build {
  const ranked = rankBuilds(course, aiStyle(k))
  const window = Math.floor(PICK_WINDOW[k]! * (ranked.length - 1))
  const rng = createRng(hashSeed(seed, 11, course.n, k))
  return ranked[rng.int(0, window)]!
}

import type { Course } from './course'
import type { Vec2 } from './types'
import type { VehicleSpec } from './vehicle'

/** 破風（§9-13）：跟在前車正後方這個距離內才有效 */
export const DRAFT_RANGE = 10
/** 跟到這個距離內效果全滿，之後到 DRAFT_RANGE 線性遞減 */
export const DRAFT_FULL = 3
/** 前車離自己車頭方向的橫向距離超過這個值就吃不到風 */
export const DRAFT_WIDTH = 1.5
/** 低於這個速度沒有破風效果 */
export const DRAFT_MIN_SPEED = 4
/** 效果全滿時：極速加成、踩踏消耗減少的比例 */
export const DRAFT_SPEED = 0.08
export const DRAFT_SAVE = 0.5

/** 後追（§9-14）：落後領先者這麼多公尺開始有加成，到 CATCHUP_FULL 加滿 */
export const CATCHUP_FROM = 40
export const CATCHUP_FULL = 200
/** 加滿時：極速加成、踩踏消耗減少的比例 */
export const CATCHUP_SPEED = 0.12
export const CATCHUP_SAVE = 0.4

/** speed：極速倍率；drain：踩踏消耗倍率；draft、catchup：0–1 的效果強度（HUD 用） */
export interface Aid {
  speed: number
  drain: number
  draft: number
  catchup: number
}

export const NO_AID: Aid = { speed: 1, drain: 1, draft: 0, catchup: 0 }

export interface DraftRider {
  pos: Vec2
  heading: number
  speed: number
}

/** 跟在 others 中任何一位正後方時的破風強度（取最強的那位） */
export function draftStrength(self: DraftRider, others: readonly Vec2[]): number {
  if (self.speed < DRAFT_MIN_SPEED) return 0
  const fx = Math.sin(self.heading)
  const fz = Math.cos(self.heading)
  let best = 0
  for (const o of others) {
    const dx = o.x - self.pos.x
    const dz = o.z - self.pos.z
    const ahead = dx * fx + dz * fz
    const side = Math.abs(dx * fz - dz * fx)
    if (ahead <= 0 || ahead > DRAFT_RANGE || side > DRAFT_WIDTH) continue
    best = Math.max(best, Math.min(1, (DRAFT_RANGE - ahead) / (DRAFT_RANGE - DRAFT_FULL)))
  }
  return best
}

/** 落後領先者 gap 公尺時的後追強度 */
export function catchupStrength(gap: number): number {
  return Math.max(0, Math.min(1, (gap - CATCHUP_FROM) / (CATCHUP_FULL - CATCHUP_FROM)))
}

export function makeAid(draft: number, catchup: number): Aid {
  if (draft === 0 && catchup === 0) return NO_AID
  return {
    speed: 1 + DRAFT_SPEED * draft + CATCHUP_SPEED * catchup,
    drain: (1 - DRAFT_SAVE * draft) * (1 - CATCHUP_SAVE * catchup),
    draft,
    catchup,
  }
}

/** 套上加成後的性能：只放大極速 */
export function aidedSpec(spec: VehicleSpec, aid: Aid): VehicleSpec {
  return aid.speed === 1 ? spec : { ...spec, maxSpeed: spec.maxSpeed * aid.speed }
}

const legCache = new WeakMap<Course, readonly number[]>()

/** 每個路口沿路線離起點的距離 */
function nodeDistances(course: Course): readonly number[] {
  let out = legCache.get(course)
  if (!out) {
    const acc = [0]
    for (let i = 1; i < course.nodes.length; i++) {
      const a = course.nodes[i - 1]!
      const b = course.nodes[i]!
      acc.push(acc[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z))
    }
    out = acc
    legCache.set(course, out)
  }
  return out
}

/**
 * 沿路線騎了幾公尺：在「上一個檢查點」到「下一個檢查點」之間的路段中，取離 pos 最近的那段做投影。
 * 已完成時為全長。
 */
export function routeProgress(course: Course, cp: number, pos: Vec2): number {
  const dist = nodeDistances(course)
  const last = course.nodes.length - 1
  if (cp >= course.checkpoints.length) return dist[last]!
  const from = cp === 0 ? 0 : course.checkpoints[cp - 1]!
  const to = course.checkpoints[cp]!
  let best = dist[from]!
  let bestD = Infinity
  for (let i = from + 1; i <= to; i++) {
    const a = course.nodes[i - 1]!
    const b = course.nodes[i]!
    const len = dist[i]! - dist[i - 1]!
    const t = Math.max(0, Math.min(1, ((pos.x - a.x) * (b.x - a.x) + (pos.z - a.z) * (b.z - a.z)) / (len * len)))
    const d = Math.hypot(a.x + (b.x - a.x) * t - pos.x, a.z + (b.z - a.z) * t - pos.z)
    if (d < bestD) {
      bestD = d
      best = dist[i - 1]! + len * t
    }
  }
  return best
}

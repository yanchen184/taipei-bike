import type { Rect, Vec2 } from './types'

export interface Circle {
  pos: Vec2
  radius: number
  /** 移動中的碰撞物每秒的位移，供 AI 預判；沒有時視為靜止 */
  vel?: Vec2
}

export function rect(minX: number, minZ: number, maxX: number, maxZ: number): Rect {
  return { minX, minZ, maxX, maxZ }
}

/** 邊界相接不算重疊 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ
}

export function pointInRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ
}

/** 線段 a→b 是否碰到矩形（slab 法） */
export function segmentHitsRect(a: Vec2, b: Vec2, r: Rect): boolean {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  if (dx === 0) {
    if (a.x < r.minX || a.x > r.maxX) return false
  } else {
    const n = (r.minX - a.x) / dx
    const f = (r.maxX - a.x) / dx
    t0 = Math.max(t0, Math.min(n, f))
    t1 = Math.min(t1, Math.max(n, f))
    if (t0 > t1) return false
  }
  const dz = b.z - a.z
  if (dz === 0) return a.z >= r.minZ && a.z <= r.maxZ
  const n = (r.minZ - a.z) / dz
  const f = (r.maxZ - a.z) / dz
  return Math.max(t0, Math.min(n, f)) <= Math.min(t1, Math.max(n, f))
}

export function circleHitsRect(p: Vec2, radius: number, r: Rect): boolean {
  const cx = Math.min(Math.max(p.x, r.minX), r.maxX)
  const cz = Math.min(Math.max(p.z, r.minZ), r.maxZ)
  return (p.x - cx) ** 2 + (p.z - cz) ** 2 < radius * radius
}

/** 把圓推出矩形，回傳推出後的位置；沒碰到回傳 null */
function pushOutOfRect(p: Vec2, radius: number, r: Rect): Vec2 | null {
  const cx = Math.min(Math.max(p.x, r.minX), r.maxX)
  const cz = Math.min(Math.max(p.z, r.minZ), r.maxZ)
  const dx = p.x - cx
  const dz = p.z - cz
  const d2 = dx * dx + dz * dz
  if (d2 >= radius * radius) return null
  if (d2 > 0) {
    const d = Math.sqrt(d2)
    return { x: cx + (dx / d) * radius, z: cz + (dz / d) * radius }
  }
  const candidates: Vec2[] = [
    { x: r.minX - radius, z: p.z },
    { x: r.maxX + radius, z: p.z },
    { x: p.x, z: r.minZ - radius },
    { x: p.x, z: r.maxZ + radius },
  ]
  let best = candidates[0]!
  for (const c of candidates) {
    if (Math.abs(c.x - p.x) + Math.abs(c.z - p.z) < Math.abs(best.x - p.x) + Math.abs(best.z - p.z)) best = c
  }
  return best
}

function pushOutOfCircle(p: Vec2, radius: number, c: Circle): Vec2 | null {
  const dx = p.x - c.pos.x
  const dz = p.z - c.pos.z
  const min = radius + c.radius
  const d2 = dx * dx + dz * dz
  if (d2 >= min * min) return null
  const d = Math.sqrt(d2)
  if (d === 0) return { x: c.pos.x + min, z: c.pos.z }
  return { x: c.pos.x + (dx / d) * min, z: c.pos.z + (dz / d) * min }
}

export interface Resolved {
  pos: Vec2
  hit: boolean
}

/** 圓形對矩形與圓形障礙物的推出運算，重複數次以處理同時碰到多個物體 */
export function resolveCircle(p: Vec2, radius: number, rects: readonly Rect[], circles: readonly Circle[] = []): Resolved {
  let pos = p
  let hit = false
  for (let pass = 0; pass < 4; pass++) {
    let moved = false
    for (const r of rects) {
      const out = pushOutOfRect(pos, radius, r)
      if (out) {
        pos = out
        moved = true
      }
    }
    for (const c of circles) {
      const out = pushOutOfCircle(pos, radius, c)
      if (out) {
        pos = out
        moved = true
      }
    }
    if (!moved) break
    hit = true
  }
  return { pos, hit }
}

export function isFree(p: Vec2, radius: number, rects: readonly Rect[], circles: readonly Circle[] = []): boolean {
  return (
    !rects.some((r) => circleHitsRect(p, radius, r)) &&
    !circles.some((c) => Math.hypot(p.x - c.pos.x, p.z - c.pos.z) < radius + c.radius)
  )
}

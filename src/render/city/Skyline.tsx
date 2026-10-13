import { useMemo } from 'react'
import { FLOOR_HEIGHT } from '../../sim/city'
import { Instanced, type Placement } from '../Instanced'
import { FACADE_VARIANTS, facadeMaterials } from '../materials'

/** 城市外圍一圈純裝飾的街屋：只畫不碰撞，蓋住邊界牆，讓城市看起來往外延伸 */
export const SKYLINE_DEPTH = 16
const UNIT = 12
const MIN_FLOORS = 4
const FLOOR_SPREAD = 6
const COLORS = ['#ffffff', '#f1e6d8', '#e4ece8', '#efe2e2'] as const

export interface SkylineGroup {
  floors: number
  variant: number
  items: Placement[]
}

/** 沿一段直線切成每 UNIT m 一棟；along 為沿線座標，across 為垂直方向的範圍 */
function strip(from: number, to: number, a0: number, a1: number, axis: 'x' | 'z', seed: number): { p: Placement; key: number }[] {
  const out: { p: Placement; key: number }[] = []
  for (let s = from, k = 0; s < to; s += UNIT, k++) {
    const len = Math.min(UNIT, to - s)
    const mid = s + len / 2
    const key = ((seed * 7919 + k * 104729) >>> 0) % 997
    const floors = MIN_FLOORS + (key % FLOOR_SPREAD)
    const color = COLORS[key % COLORS.length]
    const height = floors * FLOOR_HEIGHT
    const across = (a0 + a1) / 2
    const width = a1 - a0
    const p: Placement =
      axis === 'x'
        ? { x: mid, y: 0, z: across, sx: len, sy: height, sz: width, color }
        : { x: across, y: 0, z: mid, sx: width, sy: height, sz: len, color }
    out.push({ p, key })
  }
  return out
}

/** 外圍街屋依樓層數與立面款式分組（同組共用材質） */
export function skyline(size: number): SkylineGroup[] {
  const d = SKYLINE_DEPTH
  const all = [
    ...strip(-d, size + d, -d, 0, 'x', 1),
    ...strip(-d, size + d, size, size + d, 'x', 2),
    ...strip(0, size, -d, 0, 'z', 3),
    ...strip(0, size, size, size + d, 'z', 4),
  ]
  const groups = new Map<string, SkylineGroup>()
  for (const { p, key } of all) {
    const floors = Math.round(p.sy / FLOOR_HEIGHT)
    const variant = key % FACADE_VARIANTS
    const id = `${floors}-${variant}`
    const group = groups.get(id) ?? { floors, variant, items: [] }
    groups.set(id, { ...group, items: [...group.items, p] })
  }
  return [...groups.values()]
}

export function Skyline({ size }: { size: number }) {
  const groups = useMemo(() => skyline(size), [size])
  return (
    <group>
      {groups.map((g) => (
        <Instanced key={`${g.floors}-${g.variant}`} items={g.items} material={facadeMaterials(g.floors, g.variant)} />
      ))}
    </group>
  )
}

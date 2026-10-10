import type { Axis, Intersection } from './types'

export type Light = 'green' | 'yellow' | 'red'

export const CYCLE = 20
const GREEN = 8
const YELLOW = 2
const HALF = CYCLE / 2

/** 東西向：綠 0–8、黃 8–10、紅 10–20；南北向晚半個循環 */
export function lightState(node: Intersection, axis: Axis, t: number): Light {
  const base = (((t + node.offset) % CYCLE) + CYCLE) % CYCLE
  const phase = axis === 'ew' ? base : (base + HALF) % CYCLE
  if (phase < GREEN) return 'green'
  if (phase < GREEN + YELLOW) return 'yellow'
  return 'red'
}

/** 依路口位置決定的固定偏移（秒） */
export function lightOffset(i: number, j: number): number {
  return ((i * 3 + j * 7) % 5) * 4
}

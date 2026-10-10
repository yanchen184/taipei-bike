export interface Rng {
  next(): number
  int(min: number, max: number): number
  pick<T>(items: readonly T[]): T
  chance(p: number): boolean
}

/** mulberry32：只用 32 位元整數運算，各瀏覽器結果一致 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      const item = items[Math.floor(next() * items.length)]
      if (item === undefined) throw new Error('pick from empty list')
      return item
    },
    chance: (p) => next() < p,
  }
}

/** 由多個整數組出子 seed，讓城市各部分各自有穩定的亂數序列 */
export function hashSeed(...parts: number[]): number {
  let h = 2166136261
  for (const part of parts) {
    h = Math.imul(h ^ (part >>> 0), 16777619)
    h ^= h >>> 13
  }
  return h >>> 0
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

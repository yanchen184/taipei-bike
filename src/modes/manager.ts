import { freeRoam } from './freeRoam'
import type { GameMode, ModeContext } from './types'

export interface ModeManager {
  active(): GameMode
  /** 啟用目前模式，回傳結束函式 */
  start(): () => void
  switchTo(mode: GameMode): void
  subscribe(listener: () => void): () => void
}

/** 一次只保留一個模式；啟用中切換時先 onExit 舊模式，再 onEnter 新模式 */
export function createModeManager(ctx: ModeContext, initial: GameMode = freeRoam): ModeManager {
  let current = initial
  let running = false
  const listeners = new Set<() => void>()
  return {
    active: () => current,
    start() {
      running = true
      current.onEnter?.(ctx)
      return () => {
        current.onExit?.(ctx)
        running = false
      }
    },
    switchTo(mode) {
      if (mode === current) return
      if (running) current.onExit?.(ctx)
      current = mode
      if (running) current.onEnter?.(ctx)
      listeners.forEach((l) => l())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

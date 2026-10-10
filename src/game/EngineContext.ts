import { createContext, useContext, useSyncExternalStore } from 'react'
import type { GameEngine, HudSnapshot } from './engine'

export const EngineContext = createContext<GameEngine | null>(null)

export function useEngine(): GameEngine {
  const engine = useContext(EngineContext)
  if (!engine) throw new Error('useEngine 必須在 EngineContext.Provider 內使用')
  return engine
}

export function useHud(): HudSnapshot {
  const engine = useEngine()
  return useSyncExternalStore(engine.subscribe, engine.getHud)
}

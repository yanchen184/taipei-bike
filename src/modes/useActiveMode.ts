import { useEffect, useSyncExternalStore } from 'react'
import type { ModeManager } from './manager'
import type { GameMode } from './types'

/** 掛載期間啟用模式管理器，回傳目前模式 */
export function useActiveMode(modes: ModeManager): GameMode {
  useEffect(() => modes.start(), [modes])
  return useSyncExternalStore(modes.subscribe, modes.active)
}

import type { ComponentType } from 'react'
import type { GameEngine } from '../game/engine'

export interface ModeContext {
  engine: GameEngine
}

/** 玩法模式：自己負責場景物件與 HUD，城市核心不歸模式管 */
export interface GameMode {
  id: string
  name: string
  Scene: ComponentType
  Hud: ComponentType
  onEnter?(ctx: ModeContext): void
  onExit?(ctx: ModeContext): void
}

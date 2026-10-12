import type { GameEngine } from '../../game/engine'
import { freeRoam } from '../freeRoam'
import type { ModeManager } from '../manager'
import type { GameMode } from '../types'
import { RaceController } from './controller'
import { RaceHud } from './RaceHud'
import type { RaceLink } from './link'
import { RaceScene } from './RaceScene'

export function createRaceMode(controller: RaceController): GameMode {
  return {
    id: 'race',
    name: '腳踏車競速',
    Scene: function RaceModeScene() {
      return <RaceScene controller={controller} />
    },
    Hud: function RaceModeHud() {
      return <RaceHud controller={controller} />
    },
    onEnter: () => controller.enter(),
    onExit: () => controller.exit(),
  }
}

/** 建立一個 session 的比賽控制器，新的一局開始時切到競速模式、離開時切回自由逛街 */
export function createRace(engine: GameEngine, link: RaceLink, modes: ModeManager, onError?: (error: Error) => void): RaceController {
  const controller = new RaceController({
    engine,
    link,
    switchMode: (race) => modes.switchTo(race ? mode : freeRoam),
    onError,
  })
  const mode = createRaceMode(controller)
  return controller
}

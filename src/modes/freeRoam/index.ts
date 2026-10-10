import type { GameMode } from '../types'
import { FreeRoamHud } from './FreeRoamHud'
import { FreeRoamScene } from './FreeRoamScene'

export const freeRoam: GameMode = {
  id: 'freeRoam',
  name: '自由逛街',
  Scene: FreeRoamScene,
  Hud: FreeRoamHud,
}

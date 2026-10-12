import { useSyncExternalStore } from 'react'
import type { RaceController, RaceView } from './controller'

export function useRaceView(controller: RaceController): RaceView {
  return useSyncExternalStore(controller.subscribe, controller.view)
}

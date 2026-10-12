import { useEffect, useMemo, useState } from 'react'
import type * as THREE from 'three'
import { playHorn } from './game/audio'
import { debugEnabled, installDebug } from './game/debug'
import { GameEngine } from './game/engine'
import { EngineContext } from './game/EngineContext'
import { createKeyboard } from './game/input'
import { OnlineSession } from './game/online'
import { OnlineContext } from './game/OnlineContext'
import { freeRoam } from './modes/freeRoam'
import { createModeManager } from './modes/manager'
import { createRace } from './modes/race'
import { localRaceLink } from './modes/race/link'
import { RaceLobby } from './modes/race/RaceLobby'
import { useActiveMode } from './modes/useActiveMode'
import { World } from './render/World'
import { SAVE_KEY, loadSave } from './sim/save'
import { Hud } from './ui/Hud'
import { RoomPanel } from './ui/RoomPanel'
import { SceneErrorBoundary } from './ui/SceneErrorBoundary'
import { StampBook } from './ui/StampBook'
import { Title } from './ui/Title'

/** 單人模式的城市 seed；連線時改用房間的 seed */
const SOLO_SEED = 20261009

interface Session {
  engine: GameEngine
  online: OnlineSession | null
}

function Game({ engine, online }: Session) {
  const [keyboard] = useState(createKeyboard)
  const [scene, setScene] = useState<THREE.Scene | null>(null)
  const modes = useMemo(() => createModeManager({ engine }), [engine])
  const race = useMemo(
    () => createRace(engine, localRaceLink(online?.link.uid ?? 'solo', engine.state.save.name), modes, (e) => online?.store.setError(e.message)),
    [engine, online, modes],
  )
  const mode = useActiveMode(modes)

  useEffect(() => keyboard.attach(window, (action) => engine.action(action)), [keyboard, engine])
  useEffect(() => race.connect(), [race])
  useEffect(
    () => (debugEnabled(window.location) ? installDebug(window, engine, online, scene, race) : undefined),
    [engine, online, scene, race],
  )
  useEffect(() => online?.start(() => engine.state.player), [online, engine])

  return (
    <EngineContext.Provider value={engine}>
      <OnlineContext.Provider value={online}>
        <div data-mode={mode.id} className="relative h-screen w-screen overflow-hidden bg-black select-none">
          <SceneErrorBoundary>
            <World keyboard={keyboard} ModeScene={mode.Scene} onScene={setScene} />
          </SceneErrorBoundary>
          <Hud />
          <RoomPanel />
          <mode.Hud />
          {mode === freeRoam && <RaceLobby controller={race} />}
          <StampBook />
        </div>
      </OnlineContext.Provider>
    </EngineContext.Provider>
  )
}

function newEngine(seed: number, name: string, worldTime?: () => number): GameEngine {
  return new GameEngine({ seed, name, storage: localStorage, now: () => Date.now(), onHorn: playHorn, worldTime })
}

export default function App() {
  const initial = useMemo(() => loadSave(localStorage.getItem(SAVE_KEY)), [])
  const [session, setSession] = useState<Session | null>(null)

  const startSolo = (name: string) => setSession({ engine: newEngine(SOLO_SEED, name), online: null })

  const startOnline = async (name: string, code: string | null) => {
    const { openRoom } = await import('./net/app')
    const online = new OnlineSession(await openRoom(name, code))
    setSession({ engine: newEngine(online.link.meta.seed, name, online.worldTime), online })
  }

  if (!session) return <Title initialName={initial.save.name} saveWasReset={initial.reset} onStart={startSolo} onOnline={startOnline} />
  return <Game engine={session.engine} online={session.online} />
}

import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, use, type ComponentType, type ReactNode } from 'react'
import type * as THREE from 'three'
import { useEngine, useHud } from '../game/EngineContext'
import type { Keyboard } from '../game/input'
import { Atmosphere } from './Atmosphere'
import { CameraRig } from './CameraRig'
import { CityStatic } from './city/CityStatic'
import { InteriorView } from './InteriorView'
import { PlayerView } from './PlayerView'
import { RemotePlayers } from './RemotePlayers'
import { Signals } from './Signals'
import { loadTextures } from './textures'
import { TrafficCars } from './TrafficCars'

/** 每幀先推進遊戲狀態，再由其他元件讀 state 畫面 */
function GameLoop({ keyboard }: { keyboard: Keyboard }) {
  const engine = useEngine()
  useFrame((_, delta) => engine.update(delta, keyboard.axes()), -1)
  return null
}

/** 貼圖載入完成前不畫場景物件 */
function TexturesReady({ children }: { children: ReactNode }) {
  use(loadTextures())
  return children
}

function Outdoors() {
  const engine = useEngine()
  return (
    <>
      <CityStatic city={engine.city} />
      <Signals city={engine.city} />
      <TrafficCars />
    </>
  )
}

function Indoors() {
  const engine = useEngine()
  const inside = engine.interior()
  return inside ? <InteriorView room={inside.room} /> : null
}

interface WorldProps {
  keyboard: Keyboard
  ModeScene: ComponentType
  onScene: (scene: THREE.Scene) => void
}

export function World({ keyboard, ModeScene, onScene }: WorldProps) {
  const { homeId } = useHud()
  return (
    <Canvas camera={{ fov: 60, near: 0.1, far: 1500 }} dpr={[1, 2]} data-testid="world" onCreated={({ scene }) => onScene(scene)}>
      <GameLoop keyboard={keyboard} />
      <Atmosphere />
      <CameraRig />
      <Suspense fallback={null}>
        <TexturesReady>
          {homeId ? <Indoors key={homeId} /> : <Outdoors />}
          <PlayerView />
          <RemotePlayers />
          {!homeId && <ModeScene />}
        </TexturesReady>
      </Suspense>
    </Canvas>
  )
}

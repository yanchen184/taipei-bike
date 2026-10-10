import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { gameHour, isNight } from '../sim/clock'
import { useEngine } from '../game/EngineContext'
import { setNightGlow } from './materials'

const DAY_SKY = new THREE.Color('#a9d3f2')
const DUSK_SKY = new THREE.Color('#f0a46b')
const NIGHT_SKY = new THREE.Color('#0d1424')
const FOG_NEAR = 120
const FOG_FAR = 520
const SUN_DISTANCE = 300

/** 0 = 深夜、1 = 正午；以 06:00–18:00 的正弦曲線計算日照 */
function daylight(hour: number): number {
  return Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI))
}

function skyColor(hour: number, out: THREE.Color): THREE.Color {
  const light = daylight(hour)
  const dusk = hour > 16 && hour < 20 ? 1 - Math.abs(hour - 18) / 2 : hour > 5 && hour < 7 ? 1 - Math.abs(hour - 6) : 0
  return out.copy(NIGHT_SKY).lerp(DAY_SKY, Math.min(1, light * 1.6)).lerp(DUSK_SKY, Math.max(0, dusk) * 0.6)
}

/** 依世界時間調整天空、霧、太陽與環境光，並切換夜間發光材質 */
export function Atmosphere() {
  const engine = useEngine()
  const scene = useThree((s) => s.scene)
  const sun = useRef<THREE.DirectionalLight>(null)
  const ambient = useRef<THREE.HemisphereLight>(null)
  const night = useRef<boolean | null>(null)
  const sky = useRef(new THREE.Color())

  useFrame(() => {
    const t = engine.state.t
    const hour = gameHour(t)
    const indoors = engine.state.player.location.kind === 'home'
    const color = skyColor(hour, sky.current)
    scene.background = indoors ? NIGHT_SKY : color
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(color)
    else scene.fog = new THREE.Fog(color.clone(), FOG_NEAR, FOG_FAR)

    const light = daylight(hour)
    if (sun.current) {
      const angle = ((hour - 6) / 12) * Math.PI
      const p = engine.state.player.pos
      sun.current.position.set(p.x + Math.cos(angle) * SUN_DISTANCE, Math.max(20, Math.sin(angle) * SUN_DISTANCE), p.z - 120)
      sun.current.target.position.set(p.x, 0, p.z)
      sun.current.target.updateMatrixWorld()
      sun.current.intensity = 2.2 * light
    }
    if (ambient.current) ambient.current.intensity = indoors ? 1.4 : 0.35 + 1.1 * light

    const isDark = isNight(t)
    if (night.current !== isDark) {
      night.current = isDark
      setNightGlow(isDark)
    }
  })

  return (
    <>
      <hemisphereLight ref={ambient} args={['#dfe8f5', '#5d564c', 1]} />
      <directionalLight ref={sun} color="#fff4e0" />
    </>
  )
}

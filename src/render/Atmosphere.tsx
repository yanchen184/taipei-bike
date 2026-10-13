import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { gameHour, isNight } from '../sim/clock'
import { useEngine } from '../game/EngineContext'
import { SUNRISE, SUNSET, daylight } from './daylight'
import { setNightGlow } from './materials'

const DAY_SKY = new THREE.Color('#a9d3f2')
const DUSK_SKY = new THREE.Color('#f0a46b')
const NIGHT_SKY = new THREE.Color('#0d1424')
const FOG_NEAR = 120
const FOG_FAR = 520
const SUN_DISTANCE = 300
/** 環境光強度：夜間保留月光與路燈的亮度，路面與騎士仍看得清楚 */
const NIGHT_AMBIENT = 0.9
const DAY_AMBIENT = 1.45
/** 太陽光色：正午偏白，接近日出日落時轉成橘色斜陽 */
const NOON_SUN = new THREE.Color('#fff4e0')
const LOW_SUN = new THREE.Color('#ffa65c')

/** 晨昏的程度：0 = 白天或深夜、1 = 06:00 或 18:00 */
function duskness(hour: number): number {
  return Math.max(0, hour > 16 && hour < 20 ? 1 - Math.abs(hour - 18) / 2 : hour > 5 && hour < 7 ? 1 - Math.abs(hour - 6) : 0)
}

function skyColor(hour: number, out: THREE.Color): THREE.Color {
  const light = daylight(hour)
  return out.copy(NIGHT_SKY).lerp(DAY_SKY, Math.min(1, light * 1.6)).lerp(DUSK_SKY, duskness(hour) * 0.6)
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
      const angle = ((hour - SUNRISE) / (SUNSET - SUNRISE)) * Math.PI
      const p = engine.state.player.pos
      sun.current.position.set(p.x + Math.cos(angle) * SUN_DISTANCE, Math.max(20, Math.sin(angle) * SUN_DISTANCE), p.z - 120)
      sun.current.target.position.set(p.x, 0, p.z)
      sun.current.target.updateMatrixWorld()
      sun.current.intensity = 2.2 * light
      sun.current.color.copy(NOON_SUN).lerp(LOW_SUN, duskness(hour))
    }
    if (ambient.current) ambient.current.intensity = indoors ? 1.4 : NIGHT_AMBIENT + (DAY_AMBIENT - NIGHT_AMBIENT) * light

    const isDark = isNight(t)
    if (night.current !== isDark) {
      night.current = isDark
      setNightGlow(isDark)
    }
  })

  return (
    <>
      <hemisphereLight ref={ambient} args={['#dfe8f5', '#5d564c', 1]} />
      <directionalLight ref={sun} />
    </>
  )
}

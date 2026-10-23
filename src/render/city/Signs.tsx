import { useMemo } from 'react'
import * as THREE from 'three'
import type { Sign } from '../../sim/types'
import { plateTexture, registerSign } from '../materials'

/** 每個字的牌面寬度（m） */
const CHAR_WIDTH = 0.42
const PLATE_PAD = 0.3
const PLATE_HEIGHT = 0.6
const PLATE_DEPTH = 0.06
const POLE_HEIGHT = 3.4
const POLE_RADIUS = 0.06
const PLAQUE_CHAR = 0.9
const PLAQUE_HEIGHT = 1.2
const PLAQUE_BOTTOM = 0.4

const STREET_COLORS = { bg: '#1f6b4a', fg: '#ffffff' } as const
const PLAQUE_COLORS = { bg: '#f4efe2', fg: '#5a3b1c' } as const

const pole = new THREE.MeshLambertMaterial({ color: '#7d8a8f' })
const edge = new THREE.MeshLambertMaterial({ color: '#d8dcd9' })
const plateMaterials = new Map<string, THREE.Material[]>()

/** 牌面兩面都貼字的材質組；BoxGeometry 的材質順序是 +x −x +y −y +z −z */
export function plateFaces(text: string, colors: { bg: string; fg: string }): THREE.Material[] {
  const key = `${text}-${colors.bg}`
  const cached = plateMaterials.get(key)
  if (cached) return cached
  const map = plateTexture(text, colors.bg, colors.fg)
  const face = new THREE.MeshLambertMaterial({ map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: 0 })
  registerSign(face)
  const materials = [edge, edge, edge, edge, face, face]
  plateMaterials.set(key, materials)
  return materials
}

export function plateWidth(text: string, char = CHAR_WIDTH): number {
  return [...text].length * char + PLATE_PAD
}

/** 路口的路名牌：一根桿子，上面一塊東西向路名、下面一塊南北向路名，各自跟所指的路平行 */
function StreetSign({ sign }: { sign: Sign }) {
  const [ew, ns] = sign.lines as [string, string]
  return (
    <group position={[sign.pos.x, 0, sign.pos.z]}>
      <mesh position={[0, POLE_HEIGHT / 2, 0]} material={pole}>
        <cylinderGeometry args={[POLE_RADIUS, POLE_RADIUS, POLE_HEIGHT, 8]} />
      </mesh>
      <mesh position={[0, POLE_HEIGHT - PLATE_HEIGHT / 2, 0]} material={plateFaces(ew, STREET_COLORS)}>
        <boxGeometry args={[plateWidth(ew), PLATE_HEIGHT, PLATE_DEPTH]} />
      </mesh>
      <mesh position={[0, POLE_HEIGHT - PLATE_HEIGHT * 1.6, 0]} rotation={[0, Math.PI / 2, 0]} material={plateFaces(ns, STREET_COLORS)}>
        <boxGeometry args={[plateWidth(ns), PLATE_HEIGHT, PLATE_DEPTH]} />
      </mesh>
    </group>
  )
}

/** 地標旁的立牌 */
function Plaque({ sign }: { sign: Sign }) {
  const name = sign.lines[0]!
  return (
    <mesh position={[sign.pos.x, PLAQUE_BOTTOM + PLAQUE_HEIGHT / 2, sign.pos.z]} rotation={[0, sign.heading, 0]} material={plateFaces(name, PLAQUE_COLORS)}>
      <boxGeometry args={[plateWidth(name, PLAQUE_CHAR), PLAQUE_HEIGHT, PLATE_DEPTH * 2]} />
    </mesh>
  )
}

export function Signs({ signs }: { signs: readonly Sign[] }) {
  const street = useMemo(() => signs.filter((s) => s.kind === 'street'), [signs])
  const plaques = useMemo(() => signs.filter((s) => s.kind === 'landmark'), [signs])
  return (
    <group>
      {street.map((s) => (
        <StreetSign key={s.id} sign={s} />
      ))}
      {plaques.map((s) => (
        <Plaque key={s.id} sign={s} />
      ))}
    </group>
  )
}

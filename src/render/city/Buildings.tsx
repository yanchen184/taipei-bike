import { useMemo } from 'react'
import * as THREE from 'three'
import { FLOOR_HEIGHT } from '../../sim/city'
import type { Building, Rect, Side } from '../../sim/types'
import { Instanced, type Placement } from '../Instanced'
import { FACADE_VARIANTS, facadeMaterials, registerSign, signTexture } from '../materials'
import { tiled } from '../textures'

const PILLAR = 0.5
const TANK = 1.6
const SIGN_WIDTH = 1.2
const SIGN_CHAR = 1.2
const SIGN_DEPTH = 0.15
/** 招牌底部離地高度（二樓起） */
const SIGN_BOTTOM = FLOOR_HEIGHT + 0.6
/** 101 式塔樓：底座高、節數、每節高、每節外擴 */
const TOWER_BASE = 40
const TOWER_SEGMENTS = 7
const TOWER_SEGMENT_HEIGHT = 20
const TOWER_FLARE = 1.12

const pillarMaterial = new THREE.MeshLambertMaterial({ color: '#d8d2c4' })
const tankMaterial = new THREE.MeshLambertMaterial({ color: '#c7c9cc' })
const spireMaterial = new THREE.MeshLambertMaterial({ color: '#c9d2d0' })

let textured: { groundFloor: THREE.MeshLambertMaterial; tower: THREE.MeshLambertMaterial } | null = null

/** 貼圖材質在 loadTextures 完成後才能建立，第一次使用時建立並共用 */
function texturedMaterials() {
  textured ??= {
    groundFloor: new THREE.MeshLambertMaterial({ map: tiled('shopfront', 1, 1) }),
    tower: new THREE.MeshLambertMaterial({ map: tiled('towerGlass', 4, 4) }),
  }
  return textured
}

function hash(text: string): number {
  let h = 0
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0
  return Math.abs(h)
}

function box(r: Rect, y: number, height: number, color?: string): Placement {
  return {
    x: (r.minX + r.maxX) / 2,
    y,
    z: (r.minZ + r.maxZ) / 2,
    sx: r.maxX - r.minX,
    sy: height,
    sz: r.maxZ - r.minZ,
    ...(color ? { color } : {}),
  }
}

/** 騎樓臨街那一邊的兩個角落 */
function frontCorners(r: Rect, side: Side): [number, number][] {
  const inset = PILLAR / 2
  switch (side) {
    case 'n':
      return [[r.minX + inset, r.minZ + inset], [r.maxX - inset, r.minZ + inset]]
    case 's':
      return [[r.minX + inset, r.maxZ - inset], [r.maxX - inset, r.maxZ - inset]]
    case 'w':
      return [[r.minX + inset, r.minZ + inset], [r.minX + inset, r.maxZ - inset]]
    case 'e':
      return [[r.maxX - inset, r.minZ + inset], [r.maxX - inset, r.maxZ - inset]]
  }
}

interface FacadeGroup {
  floors: number
  variant: number
  items: Placement[]
}

interface BuildingLayout {
  facades: FacadeGroup[]
  ground: Placement[]
  pillars: Placement[]
  tanks: Placement[]
}

function layoutBuildings(buildings: readonly Building[]): BuildingLayout {
  const groups = new Map<string, FacadeGroup>()
  const ground: Placement[] = []
  const pillars: Placement[] = []
  const tanks: Placement[] = []
  for (const b of buildings) {
    if (b.kind === 'tower') continue
    const upperFloors = b.arcade ? b.floors - 1 : b.floors
    const upperBase = b.arcade ? FLOOR_HEIGHT : 0
    const variant = hash(b.id) % FACADE_VARIANTS
    const key = `${upperFloors}-${variant}`
    const group = groups.get(key) ?? { floors: upperFloors, variant, items: [] }
    group.items.push(box(b.footprint, upperBase, b.height - upperBase, b.color))
    groups.set(key, group)
    if (b.arcade) {
      ground.push(box(b.rect, 0, FLOOR_HEIGHT))
      for (const [x, z] of frontCorners(b.footprint, b.facing)) {
        pillars.push({ x, y: 0, z, sx: PILLAR, sy: FLOOR_HEIGHT, sz: PILLAR })
      }
    }
    if (hash(b.id + 'tank') % 2 === 0) {
      const cx = (b.footprint.minX + b.footprint.maxX) / 2
      const cz = (b.footprint.minZ + b.footprint.maxZ) / 2
      tanks.push({ x: cx, y: b.height, z: cz, sx: TANK, sy: TANK, sz: TANK })
    }
  }
  return { facades: [...groups.values()], ground, pillars, tanks }
}

const signMaterials = new Map<string, THREE.MeshLambertMaterial>()

/** 同字同配色共用一份材質，並登記到夜間發光清單 */
function signMaterial(text: string, variant: number): THREE.MeshLambertMaterial {
  const key = `${text}-${variant}`
  const cached = signMaterials.get(key)
  if (cached) return cached
  const map = signTexture(text, variant)
  const material = new THREE.MeshLambertMaterial({ map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: 0 })
  signMaterials.set(key, material)
  registerSign(material)
  return material
}

/** 從騎樓上方垂直伸出、垂直於立面的直立招牌 */
function Sign({ building }: { building: Building }) {
  const text = building.sign
  if (!text) return null
  const variant = hash(building.id) % 4
  const height = [...text].length * SIGN_CHAR + 0.2
  const f = building.footprint
  const [x, z] = frontCorners(f, building.facing)[hash(building.id) % 2]!
  const out = SIGN_WIDTH / 2
  const offset: Record<Side, [number, number]> = { n: [0, -out], s: [0, out], w: [-out, 0], e: [out, 0] }
  const [dx, dz] = offset[building.facing]
  const rotY = building.facing === 'n' || building.facing === 's' ? 0 : Math.PI / 2
  return (
    <mesh position={[x + dx, SIGN_BOTTOM + height / 2, z + dz]} rotation={[0, rotY, 0]} material={signMaterial(text, variant)}>
      <boxGeometry args={[SIGN_DEPTH, height, SIGN_WIDTH]} />
    </mesh>
  )
}

function Tower({ building }: { building: Building }) {
  const towerMaterial = texturedMaterials().tower
  const f = building.footprint
  const cx = (f.minX + f.maxX) / 2
  const cz = (f.minZ + f.maxZ) / 2
  const size = f.maxX - f.minX
  const top = TOWER_BASE + TOWER_SEGMENTS * TOWER_SEGMENT_HEIGHT
  const segmentBottom = size * 0.62
  return (
    <group position={[cx, 0, cz]}>
      <mesh position={[0, TOWER_BASE / 2, 0]} material={towerMaterial}>
        <boxGeometry args={[size, TOWER_BASE, size]} />
      </mesh>
      {Array.from({ length: TOWER_SEGMENTS }, (_, k) => (
        <mesh
          key={k}
          position={[0, TOWER_BASE + (k + 0.5) * TOWER_SEGMENT_HEIGHT, 0]}
          rotation={[0, Math.PI / 4, 0]}
          material={towerMaterial}
        >
          <cylinderGeometry args={[(segmentBottom * TOWER_FLARE) / Math.SQRT2, segmentBottom / Math.SQRT2, TOWER_SEGMENT_HEIGHT * 0.96, 4]} />
        </mesh>
      ))}
      <mesh position={[0, top + 6, 0]} material={spireMaterial}>
        <cylinderGeometry args={[0.6, 1.5, 12, 8]} />
      </mesh>
    </group>
  )
}

export function Buildings({ buildings }: { buildings: readonly Building[] }) {
  const layout = useMemo(() => layoutBuildings(buildings), [buildings])
  const towers = buildings.filter((b) => b.kind === 'tower')
  const shops = buildings.filter((b) => b.sign)
  const { groundFloor } = texturedMaterials()
  return (
    <group>
      {layout.facades.map((g) => (
        <Instanced key={`${g.floors}-${g.variant}`} items={g.items} material={facadeMaterials(g.floors, g.variant)} />
      ))}
      <Instanced items={layout.ground} material={groundFloor} />
      <Instanced items={layout.pillars} material={pillarMaterial} />
      <Instanced items={layout.tanks} material={tankMaterial} />
      {shops.map((b) => (
        <Sign key={b.id} building={b} />
      ))}
      {towers.map((b) => (
        <Tower key={b.id} building={b} />
      ))}
    </group>
  )
}

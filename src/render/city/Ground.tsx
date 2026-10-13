import { useMemo } from 'react'
import * as THREE from 'three'
import { BLOCK_SIZE, ROAD_COUNT, ROAD_WIDTH, SIDEWALK, roadCenter } from '../../sim/city'
import type { CityMap, Road } from '../../sim/types'
import { Instanced, type Placement } from '../Instanced'
import { tiled } from '../textures'
import { SIDEWALK_HEIGHT } from './heights'

/** 雙黃線離中線距離 */
const MEDIAN_HALF = 0.2
/** 汽車道（2.75）與機車道（5.25）之間 */
const LANE_DIVIDER = 4
const DASH = 3
const DASH_GAP = 3
const LINE = 0.15
/** 斑馬線位於路口中心往外 6–8 m（橫向道路人行道的延伸） */
const CROSSWALK_FROM = 6
const CROSSWALK_TO = 8
/** NPC 車頭停在街廓邊緣前 1 m */
const STOP_LINE_GAP = 1
const STOP_LINE_WIDTH = 0.4
const MARK_Y = 0.02
/** 一張貼圖在地面上代表的邊長（m） */
const ASPHALT_TILE = 8
const PAVING_TILE = 2
const GRASS_TILE = 4

/** 城外的地面一路鋪到霧裡，俯視或從邊緣往外看不會露出天空 */
const OUTSKIRTS = 2000
const outskirts = new THREE.MeshLambertMaterial({ color: '#6b665f' })

const white = new THREE.MeshBasicMaterial({ color: '#e8e8e2' })
const yellow = new THREE.MeshBasicMaterial({ color: '#e7b416' })

/** 沿某條路放一段標線：along 為道路方向座標，across 為離中線距離 */
function mark(road: Road, along0: number, along1: number, across: number, width: number): Placement {
  const len = along1 - along0
  const mid = (along0 + along1) / 2
  return road.axis === 'ew'
    ? { x: mid, y: MARK_Y, z: road.center + across, sx: len, sy: 0.01, sz: width }
    : { x: road.center + across, y: MARK_Y, z: mid, sx: width, sy: 0.01, sz: len }
}

function roadMarkings(city: CityMap): { white: Placement[]; yellow: Placement[] } {
  const whites: Placement[] = []
  const yellows: Placement[] = []
  const lane = ROAD_WIDTH / 2 - SIDEWALK
  for (const road of city.roads) {
    // 靠右行駛：ew 道路 +z 側、ns 道路 −x 側往座標遞增方向開
    const forwardSide = road.axis === 'ew' ? 1 : -1
    for (let k = 0; k < ROAD_COUNT - 1; k++) {
      const a0 = roadCenter(k) + ROAD_WIDTH / 2
      const a1 = roadCenter(k + 1) - ROAD_WIDTH / 2
      for (const side of [-1, 1]) {
        yellows.push(mark(road, a0, a1, side * MEDIAN_HALF, LINE))
        for (let a = a0 + 2; a + DASH <= a1 - 2; a += DASH + DASH_GAP) {
          whites.push(mark(road, a, a + DASH, side * LANE_DIVIDER, LINE))
        }
      }
      const across = (MEDIAN_HALF + lane) / 2
      const width = lane - MEDIAN_HALF
      const end = a1 - STOP_LINE_GAP
      const start = a0 + STOP_LINE_GAP
      whites.push(mark(road, end, end + STOP_LINE_WIDTH, forwardSide * across, width))
      whites.push(mark(road, start - STOP_LINE_WIDTH, start, -forwardSide * across, width))
    }
  }
  return { white: whites, yellow: yellows }
}

function crosswalks(city: CityMap): Placement[] {
  const out: Placement[] = []
  const lane = ROAD_WIDTH / 2 - SIDEWALK
  for (const node of city.intersections) {
    for (const road of city.roads) {
      const onRoad = road.axis === 'ew' ? road.center === node.z : road.center === node.x
      if (!onRoad) continue
      const nodeAlong = road.axis === 'ew' ? node.x : node.z
      for (const dir of [-1, 1]) {
        const a0 = nodeAlong + dir * CROSSWALK_FROM
        const a1 = nodeAlong + dir * CROSSWALK_TO
        if (Math.min(a0, a1) < 0 || Math.max(a0, a1) > city.size) continue
        for (let across = -lane + 0.4; across < lane; across += 1) {
          out.push(mark(road, Math.min(a0, a1), Math.max(a0, a1), across, 0.5))
        }
      }
    }
  }
  return out
}

interface Slabs {
  sidewalks: Placement[]
  paved: Placement[]
  lawns: Placement[]
}

/** 街廓：外圈人行道，內部公園鋪草、其餘鋪地磚 */
function blockSlabs(city: CityMap): Slabs {
  const out: Slabs = { sidewalks: [], paved: [], lawns: [] }
  for (const block of city.blocks) {
    const r = block.rect
    const sidewalk: Placement = {
      x: (r.minX + r.maxX) / 2,
      y: 0,
      z: (r.minZ + r.maxZ) / 2,
      sx: BLOCK_SIZE + 2 * SIDEWALK,
      sy: SIDEWALK_HEIGHT,
      sz: BLOCK_SIZE + 2 * SIDEWALK,
    }
    out.sidewalks.push(sidewalk)
    const inner: Placement = { ...sidewalk, y: 0.01, sx: BLOCK_SIZE, sz: BLOCK_SIZE }
    ;(block.kind === 'park' ? out.lawns : out.paved).push(inner)
  }
  return out
}

let surfaces: Record<'sidewalk' | 'paved' | 'lawn', THREE.MeshLambertMaterial> | null = null

/** 街廓尺寸固定，重複次數依 BLOCK_SIZE 算一次後共用 */
function surfaceMaterials(): NonNullable<typeof surfaces> {
  const outer = (BLOCK_SIZE + 2 * SIDEWALK) / PAVING_TILE
  const inner = BLOCK_SIZE / PAVING_TILE
  surfaces ??= {
    sidewalk: new THREE.MeshLambertMaterial({ map: tiled('sidewalk', outer, outer) }),
    paved: new THREE.MeshLambertMaterial({ map: tiled('sidewalk', inner, inner) }),
    lawn: new THREE.MeshLambertMaterial({ map: tiled('grass', BLOCK_SIZE / GRASS_TILE, BLOCK_SIZE / GRASS_TILE) }),
  }
  return surfaces
}

const asphaltCache = new Map<number, THREE.MeshLambertMaterial>()

function asphaltMaterial(size: number): THREE.MeshLambertMaterial {
  const cached = asphaltCache.get(size)
  if (cached) return cached
  const material = new THREE.MeshLambertMaterial({ map: tiled('asphalt', size / ASPHALT_TILE, size / ASPHALT_TILE) })
  asphaltCache.set(size, material)
  return material
}

export function Ground({ city }: { city: CityMap }) {
  const marks = useMemo(() => roadMarkings(city), [city])
  const zebra = useMemo(() => crosswalks(city), [city])
  const slabs = useMemo(() => blockSlabs(city), [city])
  const size = city.size + 40
  const asphalt = asphaltMaterial(size)
  const surface = surfaceMaterials()
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[city.size / 2, -0.2, city.size / 2]} material={outskirts}>
        <planeGeometry args={[OUTSKIRTS, OUTSKIRTS]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[city.size / 2, 0, city.size / 2]} material={asphalt}>
        <planeGeometry args={[size, size]} />
      </mesh>
      <Instanced items={slabs.sidewalks} material={surface.sidewalk} />
      <Instanced items={slabs.paved} material={surface.paved} />
      <Instanced items={slabs.lawns} material={surface.lawn} />
      <Instanced items={marks.white} material={white} />
      <Instanced items={marks.yellow} material={yellow} />
      <Instanced items={zebra} material={white} />
    </group>
  )
}

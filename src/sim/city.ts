import { rect, pointInRect } from './collide'
import { lightOffset } from './lights'
import { createRng, hashSeed, shuffle, type Rng } from './rng'
import type {
  Block,
  BlockKind,
  Building,
  CityMap,
  Home,
  Intersection,
  Mrt,
  Pose,
  Prop,
  Rect,
  Road,
  Side,
  Sign,
  Vec2,
} from './types'

export const BLOCK_SIZE = 60
export const ROAD_WIDTH = 16
export const ROAD_COUNT = 5
export const STRIDE = BLOCK_SIZE + ROAD_WIDTH
export const CITY_SIZE = ROAD_COUNT * ROAD_WIDTH + (ROAD_COUNT - 1) * BLOCK_SIZE
export const SIDEWALK = 2
/** 車道中心到道路中線的距離：汽車道與機車道 */
export const CAR_LANE_OFFSET = 2.75
export const SCOOTER_LANE_OFFSET = 5.25
export const ARCADE_DEPTH = 3
export const FLOOR_HEIGHT = 3.2
const ROW_DEPTH = 20
const UNIT_WIDTH = 12
const UNITS_PER_ROW = BLOCK_SIZE / UNIT_WIDTH
const DOOR_SPACING = 6
const WALL_THICKNESS = 4
const TOWER_SIZE = 28
const TOWER_HEIGHT = 200
const MRT_HEIGHT = 9
const PILLAR_SIZE = 1.2
const PILLAR_SPACING = 12
const LAMP_SPACING = 20

/** 由北到南 */
const EW_ROAD_NAMES = ['市民大道', '忠孝東路', '仁愛路', '信義路', '和平東路']
/** 由西到東；中山路在忠孝東路（第 1 條東西向道路）以北叫中山北路 */
const NS_ROAD_NAMES = ['中山南路', '新生南路', '復興南路', '敦化南路', '光復南路']
const NORTH_SEGMENTS: Record<number, { name: string; until: number }> = { 0: { name: '中山北路', until: 1 } }

/** 規則 §1-4 的固定街廓 */
const FIXED_BLOCKS: { i: number; j: number; kind: BlockKind; name?: string }[] = [
  { i: 3, j: 3, kind: 'landmark', name: '台北101' },
  { i: 1, j: 3, kind: 'park', name: '大安森林公園' },
  { i: 2, j: 0, kind: 'shops' },
  { i: 2, j: 1, kind: 'shops' },
]
const MRT_ROAD = 2
const MRT_NAME = '文湖線'
/** 車站在第 span 段（第 span 與 span+1 條東西向道路之間）靠南端 */
const MRT_STATIONS = [
  { name: '忠孝復興', span: 0 },
  { name: '大安', span: 2 },
]
const STATION_LENGTH = 30
const STATION_GAP = 10

const APARTMENT_COLORS = ['#d9cbb3', '#c9c3b8', '#e3d5c8', '#bfb2a0', '#d4c4a8', '#cfd2c9', '#e0c9b6']
const SHOP_COLORS = ['#c8b8a6', '#b8aea0', '#d6c2a8', '#c2c6c0']
const SHOP_SIGNS = ['便利商店', '手搖飲', '滷肉飯', '牛肉麵', '早餐店', '藥局', '雞排', '鹹酥雞', '書局', '水果行', '豆花', '麵線']
const SURNAMES = ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊', '許', '鄭', '謝', '郭', '洪']
const GIVEN_NAMES = ['志明', '春嬌', '淑芬', '家豪', '怡君', '俊傑', '雅婷', '建宏', '美玲', '冠宇', '佩珊', '宗翰', '惠君', '承恩', '欣怡']

/** 朝外的朝向（前進方向 = (sin h, cos h)） */
const SIDE_HEADING: Record<Side, number> = { n: Math.PI, s: 0, w: -Math.PI / 2, e: Math.PI / 2 }

export function roadCenter(index: number): number {
  return ROAD_WIDTH / 2 + index * STRIDE
}

function blockRect(i: number, j: number): Rect {
  const x0 = ROAD_WIDTH + i * STRIDE
  const z0 = ROAD_WIDTH + j * STRIDE
  return rect(x0, z0, x0 + BLOCK_SIZE, z0 + BLOCK_SIZE)
}

function segmentsOf(name: string, north?: { name: string; until: number }): string[] {
  return Array.from({ length: ROAD_COUNT - 1 }, (_, k) => (north && k < north.until ? north.name : name))
}

function buildRoads(): Road[] {
  return [
    ...EW_ROAD_NAMES.map((name, index): Road => ({ id: `ew${index}`, axis: 'ew', index, center: roadCenter(index), segments: segmentsOf(name) })),
    ...NS_ROAD_NAMES.map(
      (name, index): Road => ({ id: `ns${index}`, axis: 'ns', index, center: roadCenter(index), segments: segmentsOf(name, NORTH_SEGMENTS[index]) }),
    ),
  ]
}

/** 道路在某個沿路座標（ew 道路是 x、ns 道路是 z）那一段的路名 */
export function roadNameAt(road: Road, along: number): string {
  const k = Math.floor((along - ROAD_WIDTH / 2) / STRIDE)
  return road.segments[Math.min(Math.max(k, 0), road.segments.length - 1)]!
}

function buildIntersections(): Intersection[] {
  const out: Intersection[] = []
  for (let j = 0; j < ROAD_COUNT; j++) {
    for (let i = 0; i < ROAD_COUNT; i++) {
      out.push({ id: `x${i}-${j}`, i, j, x: roadCenter(i), z: roadCenter(j), offset: lightOffset(i, j) })
    }
  }
  return out
}

function assignBlockKinds(rng: Rng): Block[] {
  const n = ROAD_COUNT - 1
  const rest: BlockKind[] = shuffle(['park', 'shops', 'shops', ...Array<BlockKind>(n * n - FIXED_BLOCKS.length - 3).fill('apartment')], rng)
  const blocks: Block[] = []
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const fixed = FIXED_BLOCKS.find((b) => b.i === i && b.j === j)
      const base = { id: `blk${i}-${j}`, i, j, rect: blockRect(i, j) }
      blocks.push(fixed ? { ...base, kind: fixed.kind, ...(fixed.name ? { name: fixed.name } : {}) } : { ...base, kind: rest.pop()! })
    }
  }
  return blocks
}

/** 一排建築沿著街廓的某一邊；k = 這排第幾棟 */
function unitRects(b: Rect, side: Side, k: number): { footprint: Rect; collider: Rect; along: number } {
  const a0 = (side === 'n' || side === 's' ? b.minX : b.minZ) + k * UNIT_WIDTH
  const a1 = a0 + UNIT_WIDTH
  const along = (a0 + a1) / 2
  switch (side) {
    case 'n':
      return { footprint: rect(a0, b.minZ, a1, b.minZ + ROW_DEPTH), collider: rect(a0, b.minZ + ARCADE_DEPTH, a1, b.minZ + ROW_DEPTH), along }
    case 's':
      return { footprint: rect(a0, b.maxZ - ROW_DEPTH, a1, b.maxZ), collider: rect(a0, b.maxZ - ROW_DEPTH, a1, b.maxZ - ARCADE_DEPTH), along }
    case 'w':
      return { footprint: rect(b.minX, a0, b.minX + ROW_DEPTH, a1), collider: rect(b.minX + ARCADE_DEPTH, a0, b.minX + ROW_DEPTH, a1), along }
    case 'e':
      return { footprint: rect(b.maxX - ROW_DEPTH, a0, b.maxX, a1), collider: rect(b.maxX - ROW_DEPTH, a0, b.maxX - ARCADE_DEPTH, a1), along }
  }
}

function doorPosition(b: Rect, side: Side, along: number): Vec2 {
  const inset = ARCADE_DEPTH - 1
  switch (side) {
    case 'n':
      return { x: along, z: b.minZ + inset }
    case 's':
      return { x: along, z: b.maxZ - inset }
    case 'w':
      return { x: b.minX + inset, z: along }
    case 'e':
      return { x: b.maxX - inset, z: along }
  }
}

/** 街廓這一邊面對的道路 */
function facingRoad(roads: Road[], block: Block, side: Side): Road {
  const id = { n: `ew${block.j}`, s: `ew${block.j + 1}`, w: `ns${block.i}`, e: `ns${block.i + 1}` }[side]
  const road = roads.find((r) => r.id === id)
  if (!road) throw new Error(`missing road ${id}`)
  return road
}

/** 門牌號：依沿路位置編號；街廓在道路南側或東側為雙號，北側或西側為單號 */
function houseNumber(along: number, side: Side): number {
  const parity = side === 'n' || side === 'w' ? 2 : 1
  return 2 * Math.round(along / DOOR_SPACING) + parity
}

function residentName(rng: Rng): string {
  return rng.pick(SURNAMES) + rng.pick(GIVEN_NAMES)
}

function buildRows(block: Block, roads: Road[], rng: Rng): { buildings: Building[]; homes: Home[] } {
  const sides: Side[] = rng.chance(0.5) ? ['n', 's'] : ['w', 'e']
  const buildings: Building[] = []
  const homes: Home[] = []
  for (const side of sides) {
    const road = facingRoad(roads, block, side)
    for (let k = 0; k < UNITS_PER_ROW; k++) {
      const { footprint, collider, along } = unitRects(block.rect, side, k)
      const isShop = block.kind === 'shops'
      const floors = isShop ? rng.int(3, 5) : rng.int(4, 5)
      const id = `b${block.i}-${block.j}-${side}${k}`
      buildings.push({
        id,
        kind: isShop ? 'shop' : 'apartment',
        rect: collider,
        footprint,
        height: floors * FLOOR_HEIGHT,
        floors,
        facing: side,
        arcade: true,
        color: rng.pick(isShop ? SHOP_COLORS : APARTMENT_COLORS),
        ...(isShop ? { sign: rng.pick(SHOP_SIGNS) } : {}),
      })
      if (isShop) continue
      const doorCount = rng.int(1, 2)
      for (let d = 0; d < doorCount; d++) {
        const doorAlong = along + (d === 0 ? -DOOR_SPACING / 2 : DOOR_SPACING / 2)
        const number = houseNumber(doorAlong, side)
        const floor = rng.int(1, floors)
        const door = doorPosition(block.rect, side, doorAlong)
        const roadName = roadNameAt(road, road.axis === 'ew' ? door.x : door.z)
        homes.push({
          id: `${road.id}-${number}`,
          address: `${roadName} ${number} 號 ${floor} 樓`,
          roadName,
          number,
          floor,
          buildingId: id,
          door,
          facing: SIDE_HEADING[side],
          seed: rng.int(0, 2 ** 31 - 1),
          resident: residentName(rng),
        })
      }
    }
  }
  return { buildings, homes }
}

function placeProps(block: Block, rng: Rng, kinds: { kind: Prop['kind']; w: number; d: number; count: number }[], keepOut: Rect[]): Prop[] {
  const margin = 3
  const inner = rect(block.rect.minX + margin, block.rect.minZ + margin, block.rect.maxX - margin, block.rect.maxZ - margin)
  const props: Prop[] = []
  const taken: Rect[] = [...keepOut]
  for (const spec of kinds) {
    for (let n = 0, tries = 0; n < spec.count && tries < 200; tries++) {
      const turned = rng.chance(0.5)
      const w = turned ? spec.d : spec.w
      const d = turned ? spec.w : spec.d
      const x = inner.minX + w / 2 + rng.next() * (inner.maxX - inner.minX - w)
      const z = inner.minZ + d / 2 + rng.next() * (inner.maxZ - inner.minZ - d)
      const r = rect(x - w / 2, z - d / 2, x + w / 2, z + d / 2)
      const padded = rect(r.minX - 1, r.minZ - 1, r.maxX + 1, r.maxZ + 1)
      if (taken.some((t) => t.minX < padded.maxX && padded.minX < t.maxX && t.minZ < padded.maxZ && padded.minZ < t.maxZ)) continue
      taken.push(r)
      props.push({ id: `p${block.i}-${block.j}-${props.length}`, kind: spec.kind, pos: { x, z }, heading: turned ? Math.PI / 2 : 0, rect: r })
      n++
    }
  }
  return props
}

function buildLamps(blocks: Block[]): Prop[] {
  const lamps: Prop[] = []
  for (const block of blocks) {
    const b = block.rect
    for (let a = LAMP_SPACING / 2; a < BLOCK_SIZE; a += LAMP_SPACING) {
      const spots: [Vec2, number][] = [
        [{ x: b.minX + a, z: b.minZ - SIDEWALK / 2 }, SIDE_HEADING.n],
        [{ x: b.minX + a, z: b.maxZ + SIDEWALK / 2 }, SIDE_HEADING.s],
        [{ x: b.minX - SIDEWALK / 2, z: b.minZ + a }, SIDE_HEADING.w],
        [{ x: b.maxX + SIDEWALK / 2, z: b.minZ + a }, SIDE_HEADING.e],
      ]
      for (const [pos, heading] of spots) lamps.push({ id: `lamp${lamps.length}`, kind: 'lamp', pos, heading })
    }
  }
  return lamps
}

function buildMrt(): Mrt {
  const x = roadCenter(MRT_ROAD)
  const half = PILLAR_SIZE / 2
  const pillars: Rect[] = []
  for (let j = 0; j < ROAD_COUNT - 1; j++) {
    const z0 = ROAD_WIDTH + j * STRIDE
    for (let z = z0 + PILLAR_SPACING / 2; z < z0 + BLOCK_SIZE; z += PILLAR_SPACING) {
      pillars.push(rect(x - half, z - half, x + half, z + half))
    }
  }
  const stations = MRT_STATIONS.map(({ span }) => {
    const end = ROAD_WIDTH + span * STRIDE + BLOCK_SIZE - STATION_GAP
    return rect(x - 10, end - STATION_LENGTH, x + 10, end)
  })
  return { roadId: `ns${MRT_ROAD}`, name: MRT_NAME, height: MRT_HEIGHT, pillars, stations, stationNames: MRT_STATIONS.map((s) => s.name) }
}

/** 路口西北角與東南角各一支路名牌，寫那個角落所在路段的路名；地標街廓北側人行道一支立牌 */
function buildSigns(roads: Road[], intersections: Intersection[], blocks: Block[]): Sign[] {
  const inset = ROAD_WIDTH / 2 - SIDEWALK / 2
  const signs: Sign[] = []
  for (const node of intersections) {
    const ew = roads.find((r) => r.axis === 'ew' && r.index === node.j)!
    const ns = roads.find((r) => r.axis === 'ns' && r.index === node.i)!
    for (const [d, corner, heading] of [[-1, 'nw', SIDE_HEADING.n], [1, 'se', SIDE_HEADING.s]] as const) {
      const pos = { x: node.x + d * inset, z: node.z + d * inset }
      signs.push({ id: `sign${node.i}-${node.j}${corner}`, kind: 'street', pos, heading, lines: [roadNameAt(ew, pos.x), roadNameAt(ns, pos.z)] })
    }
  }
  for (const block of blocks) {
    if (!block.name) continue
    const r = block.rect
    const pos = { x: (r.minX + r.maxX) / 2, z: r.minZ - SIDEWALK / 2 }
    signs.push({ id: `plaque${block.i}-${block.j}`, kind: 'landmark', pos, heading: SIDE_HEADING.n, lines: [block.name] })
  }
  return signs
}

function buildWalls(): Rect[] {
  const s = CITY_SIZE
  const t = WALL_THICKNESS
  return [rect(-t, -t, s + t, 0), rect(-t, s, s + t, s + t), rect(-t, 0, 0, s), rect(s, 0, s + t, s)]
}

export function generateCity(seed: number): CityMap {
  const roads = buildRoads()
  const intersections = buildIntersections()
  const blocks = assignBlockKinds(createRng(hashSeed(seed, 1)))
  const buildings: Building[] = []
  const homes: Home[] = []
  const props: Prop[] = []

  for (const block of blocks) {
    const rng = createRng(hashSeed(seed, 2, block.i, block.j))
    if (block.kind === 'apartment' || block.kind === 'shops') {
      const rows = buildRows(block, roads, rng)
      buildings.push(...rows.buildings)
      homes.push(...rows.homes)
    } else if (block.kind === 'park') {
      props.push(
        ...placeProps(block, rng, [
          { kind: 'slide', w: 4, d: 1.5, count: 1 },
          { kind: 'bench', w: 2, d: 0.7, count: 4 },
          { kind: 'tree', w: 0.8, d: 0.8, count: 14 },
        ], []),
      )
    } else {
      const cx = (block.rect.minX + block.rect.maxX) / 2
      const cz = (block.rect.minZ + block.rect.maxZ) / 2
      const half = TOWER_SIZE / 2
      const footprint = rect(cx - half, cz - half, cx + half, cz + half)
      buildings.push({
        id: `tower${block.i}-${block.j}`,
        kind: 'tower',
        rect: footprint,
        footprint,
        height: TOWER_HEIGHT,
        floors: Math.round(TOWER_HEIGHT / FLOOR_HEIGHT),
        facing: 's',
        arcade: false,
        color: '#7fa7a0',
      })
      props.push(...placeProps(block, rng, [{ kind: 'tree', w: 0.8, d: 0.8, count: 8 }], [footprint]))
    }
  }
  props.push(...buildLamps(blocks))

  const mrt = buildMrt()
  const signs = buildSigns(roads, intersections, blocks)
  const walls = buildWalls()
  const colliders = [
    ...buildings.map((b) => b.rect),
    ...props.flatMap((p) => (p.rect ? [p.rect] : [])),
    ...mrt.pillars,
    ...walls,
  ]
  return { seed, size: CITY_SIZE, roads, intersections, blocks, buildings, props, homes, mrt, signs, walls, colliders }
}

function roadRect(road: Road): Rect {
  const half = ROAD_WIDTH / 2
  return road.axis === 'ew'
    ? rect(0, road.center - half, CITY_SIZE, road.center + half)
    : rect(road.center - half, 0, road.center + half, CITY_SIZE)
}

/** 位置是否在道路（含人行道）範圍內 */
export function isOnRoad(city: CityMap, p: Vec2): boolean {
  return city.roads.some((road) => pointInRect(p, roadRect(road)))
}

/** 離某點最近的汽車道位置，朝向依右側通行 */
export function nearestRoadPose(city: CityMap, p: Vec2): Pose {
  const min = ROAD_WIDTH / 2
  const max = city.size - ROAD_WIDTH / 2
  const clamp = (v: number) => Math.min(Math.max(v, min), max)
  let best: Pose | null = null
  let bestDist = Infinity
  for (const road of city.roads) {
    for (const side of [-1, 1]) {
      const lane = road.center + side * CAR_LANE_OFFSET
      const pose: Pose =
        road.axis === 'ew'
          ? { pos: { x: clamp(p.x), z: lane }, heading: side > 0 ? Math.PI / 2 : -Math.PI / 2 }
          : { pos: { x: lane, z: clamp(p.z) }, heading: side > 0 ? Math.PI : 0 }
      const d = Math.hypot(pose.pos.x - p.x, pose.pos.z - p.z)
      if (d < bestDist) {
        best = pose
        bestDist = d
      }
    }
  }
  if (!best) throw new Error('city has no roads')
  return best
}

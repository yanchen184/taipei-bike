export interface Vec2 {
  x: number
  z: number
}

export interface Rect {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

export type Axis = 'ew' | 'ns'

/** ew 道路是 z = center 的水平線；ns 道路是 x = center 的垂直線 */
export interface Road {
  id: string
  axis: Axis
  index: number
  center: number
  name: string
}

/** i = 南北向道路序號（決定 x），j = 東西向道路序號（決定 z） */
export interface Intersection {
  id: string
  i: number
  j: number
  x: number
  z: number
  offset: number
}

export type BlockKind = 'apartment' | 'shops' | 'park' | 'landmark'

export interface Block {
  id: string
  i: number
  j: number
  rect: Rect
  kind: BlockKind
}

export type Side = 'n' | 'e' | 's' | 'w'

export type BuildingKind = 'apartment' | 'shop' | 'tower'

export interface Building {
  id: string
  kind: BuildingKind
  /** 碰撞範圍（騎樓已從正面扣掉） */
  rect: Rect
  /** 外觀範圍（上方樓層蓋過騎樓） */
  footprint: Rect
  height: number
  floors: number
  facing: Side
  arcade: boolean
  color: string
  sign?: string
}

export type PropKind = 'tree' | 'bench' | 'slide' | 'lamp'

export interface Prop {
  id: string
  kind: PropKind
  pos: Vec2
  heading: number
  rect?: Rect
}

export interface Home {
  id: string
  address: string
  roadName: string
  number: number
  floor: number
  buildingId: string
  /** 大門位置（騎樓內，建築正面外 1 m） */
  door: Vec2
  /** 從屋內往外的朝向 */
  facing: number
  seed: number
  resident: string
}

export interface Mrt {
  roadId: string
  height: number
  pillars: Rect[]
  stations: Rect[]
}

export interface CityMap {
  seed: number
  size: number
  roads: Road[]
  intersections: Intersection[]
  blocks: Block[]
  buildings: Building[]
  props: Prop[]
  homes: Home[]
  mrt: Mrt
  walls: Rect[]
  colliders: Rect[]
}

export interface Pose {
  pos: Vec2
  heading: number
}

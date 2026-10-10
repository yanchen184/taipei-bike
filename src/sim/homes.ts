import { rect } from './collide'
import { createRng } from './rng'
import type { CityMap, Home, Rect, Vec2 } from './types'
import type { PlayerState } from './player'

export const DOOR_DISTANCE = 2
export const GREET_DISTANCE = 3
const WALL = 0.3
const DOORWAY = 1.2

/** 乘在 interior-floor 貼圖上的色調 */
const FLOOR_COLORS = ['#ffffff', '#f4ede2', '#ece6dc', '#f7efe6', '#e9e4dc']
const WALL_COLORS = ['#f3efe6', '#e8f0e8', '#f1e3d3', '#dde6ee', '#f5e6e8']
const SOFA_COLORS = ['#6b7f99', '#9b5c4b', '#5f7a5a', '#8a7a68']
const BED_COLORS = ['#e9d8c4', '#c7d3e6', '#e6c7cf', '#d6e3cf']

export type FurnitureKind = 'sofa' | 'table' | 'tv' | 'bed' | 'wardrobe' | 'desk' | 'plant'

export interface Furniture {
  kind: FurnitureKind
  rect: Rect
  height: number
  color: string
}

/** 室內使用自己的座標：x 0..width、z 0..depth，大門在 z = depth 那面牆 */
export interface Interior {
  width: number
  depth: number
  partitionX: number
  doorway: { z0: number; z1: number }
  door: Vec2
  spawn: Vec2
  floorColor: string
  wallColor: string
  walls: Rect[]
  furniture: Furniture[]
  colliders: Rect[]
  resident: { pos: Vec2 }
}

export interface DoorPrompt {
  home: Home
  text: string
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

export function homeAt(city: CityMap, id: string): Home | undefined {
  return city.homes.find((h) => h.id === id)
}

export function generateInterior(home: Home): Interior {
  const rng = createRng(home.seed)
  const width = rng.int(11, 13)
  const depth = rng.int(8, 10)
  const partitionX = rng.int(6, 7)
  const gz0 = 3 + rng.next() * (depth - 5 - DOORWAY)
  const doorway = { z0: gz0, z1: gz0 + DOORWAY }
  const doorX = 2 + rng.next() * (partitionX - 4)
  const door = { x: doorX, z: depth - 0.6 }
  const spawn = { x: doorX, z: depth - 1.8 }

  const sofaX = 0.8 + rng.next() * (partitionX - 3.8)
  const furniture: Furniture[] = [
    { kind: 'sofa', rect: rect(sofaX, 0.2, sofaX + 2.2, 1.1), height: 0.8, color: rng.pick(SOFA_COLORS) },
    { kind: 'table', rect: rect(sofaX + 0.5, 2, sofaX + 1.7, 2.6), height: 0.45, color: '#8a6440' },
    { kind: 'tv', rect: rect(WALL / 2, depth / 2 - 0.8, 0.6, depth / 2 + 0.8), height: 1.1, color: '#2b2b2b' },
    { kind: 'bed', rect: rect(partitionX + 0.5, 0.2, partitionX + 2.1, 2.2), height: 0.5, color: rng.pick(BED_COLORS) },
    { kind: 'wardrobe', rect: rect(width - 0.7, 0.4, width - 0.1, 1.8), height: 2.1, color: '#a07850' },
    { kind: 'desk', rect: rect(width - 1.5, depth - 1.0, width - 0.2, depth - 0.3), height: 0.75, color: '#c49a6c' },
  ]
  if (rng.chance(0.6)) {
    furniture.push({ kind: 'plant', rect: rect(partitionX - 0.8, 0.3, partitionX - 0.3, 0.8), height: 1.2, color: '#4f8a4b' })
  }

  const walls = [
    rect(-WALL, -WALL, width + WALL, 0),
    rect(-WALL, depth, width + WALL, depth + WALL),
    rect(-WALL, 0, 0, depth),
    rect(width, 0, width + WALL, depth),
    rect(partitionX - WALL / 2, 0, partitionX + WALL / 2, doorway.z0),
    rect(partitionX - WALL / 2, doorway.z1, partitionX + WALL / 2, depth),
  ]
  return {
    width,
    depth,
    partitionX,
    doorway,
    door,
    spawn,
    floorColor: rng.pick(FLOOR_COLORS),
    wallColor: rng.pick(WALL_COLORS),
    walls,
    furniture,
    colliders: [...walls, ...furniture.map((f) => f.rect)],
    resident: { pos: { x: partitionX / 2 + 0.6, z: 3.6 } },
  }
}

export function doorPrompt(state: PlayerState, city: CityMap): DoorPrompt | null {
  if (state.mode !== 'walk' || state.location.kind !== 'outdoor') return null
  let best: Home | null = null
  let bestDist = DOOR_DISTANCE
  for (const home of city.homes) {
    const d = distance(state.pos, home.door)
    if (d <= bestDist) {
      best = home
      bestDist = d
    }
  }
  return best ? { home: best, text: `按 E 拜訪 ${best.address}` } : null
}

export function enterHome(state: PlayerState, city: CityMap): PlayerState | null {
  const prompt = doorPrompt(state, city)
  if (!prompt) return null
  const room = generateInterior(prompt.home)
  return { ...state, location: { kind: 'home', homeId: prompt.home.id }, pos: room.spawn, heading: Math.PI }
}

export function canExitHome(state: PlayerState, room: Interior): boolean {
  return state.location.kind === 'home' && distance(state.pos, room.door) <= DOOR_DISTANCE
}

export function exitHome(state: PlayerState, city: CityMap): PlayerState | null {
  if (state.location.kind !== 'home') return null
  const home = homeAt(city, state.location.homeId)
  if (!home || !canExitHome(state, generateInterior(home))) return null
  const pos = { x: home.door.x + Math.sin(home.facing), z: home.door.z + Math.cos(home.facing) }
  return { ...state, location: { kind: 'outdoor' }, pos, heading: home.facing }
}

export function greeting(room: Interior, home: Home, pos: Vec2): string | null {
  if (distance(pos, room.resident.pos) > GREET_DISTANCE) return null
  return `你好！我是${home.resident}，歡迎來坐坐～`
}

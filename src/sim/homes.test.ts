import { describe, expect, test } from 'vitest'
import { generateCity } from './city'
import { circleHitsRect, isFree } from './collide'
import {
  DOOR_DISTANCE,
  GREET_DISTANCE,
  doorPrompt,
  enterHome,
  exitHome,
  generateInterior,
  greeting,
  homeAt,
} from './homes'
import { WALK_RADIUS, createPlayer, type PlayerState } from './player'
import type { Home, Vec2 } from './types'

const city = generateCity(9)
const home = city.homes[4]!

function at(pos: Vec2, mode: PlayerState['mode'] = 'walk'): PlayerState {
  return { ...createPlayer(city), mode, pos }
}

function offsetFromDoor(h: Home, d: number): Vec2 {
  return { x: h.door.x + Math.sin(h.facing) * d, z: h.door.z + Math.cos(h.facing) * d }
}

describe('H1 進門', () => {
  test('[H1-1] 步行到可拜訪住家大門 2 m 內顯示含門牌的提示，超過 2 m 不顯示', () => {
    expect(DOOR_DISTANCE).toBe(2)
    const near = doorPrompt(at(offsetFromDoor(home, 1.9)), city)
    expect(near?.home.id).toBe(home.id)
    expect(near?.text).toBe(`按 E 拜訪 ${home.address}`)
    expect(doorPrompt(at(offsetFromDoor(home, 2.1)), city)?.home.id).not.toBe(home.id)
  })

  test('[H1-2] 在大門 2 m 內按 E 進入該戶室內，超過 2 m 不能進門', () => {
    for (const h of city.homes) {
      const inside = enterHome(at(offsetFromDoor(h, 1.5)), city)
      const room = generateInterior(h)
      expect(inside?.location).toEqual({ kind: 'home', homeId: h.id })
      expect(inside?.pos).toEqual(room.spawn)
      expect(room.colliders.some((r) => circleHitsRect(room.spawn, WALK_RADIUS, r))).toBe(false)
    }
    const tooFar = enterHome(at(offsetFromDoor(home, 2.1)), city)
    expect(tooFar?.location).not.toEqual({ kind: 'home', homeId: home.id })
  })

  test('[H1-3] 開車時靠近大門不會出現提示也不能進門', () => {
    const driving = at(offsetFromDoor(home, 1), 'drive')
    expect(doorPrompt(driving, city)).toBeNull()
    expect(enterHome(driving, city)).toBeNull()
    const entered = enterHome(at(offsetFromDoor(home, 1)), city)
    expect(entered?.location).toEqual({ kind: 'home', homeId: home.id })
  })
})

describe('H2 室內', () => {
  test('[H2-1] 同一戶每次產生的室內格局相同，不同戶的格局可以不同', () => {
    expect(generateInterior(home)).toEqual(generateInterior(home))
    const layouts = new Set(city.homes.slice(0, 10).map((h) => JSON.stringify(generateInterior(h))))
    expect(layouts.size).toBeGreaterThan(1)
    for (const h of city.homes) {
      const room = generateInterior(h)
      expect(room.colliders.some((r) => circleHitsRect(room.spawn, WALK_RADIUS, r))).toBe(false)
      expect(room.colliders.some((r) => circleHitsRect(room.resident.pos, 0.3, r))).toBe(false)
    }
  })

  test('[H2-2] 靠近住戶 3 m 內顯示住戶打招呼與名字', () => {
    expect(GREET_DISTANCE).toBe(3)
    const room = generateInterior(home)
    const near = { x: room.resident.pos.x + 2.9, z: room.resident.pos.z }
    const far = { x: room.resident.pos.x + 3.1, z: room.resident.pos.z }
    expect(greeting(room, home, near)).toContain(home.resident)
    expect(greeting(room, home, far)).toBeNull()
  })

  test('[H2-3] 在室內大門按 E 回到戶外，位置在該戶大門外', () => {
    const inside = enterHome(at(home.door), city)!
    const room = generateInterior(home)
    expect(exitHome({ ...inside, pos: { x: room.door.x + 5, z: room.door.z + 5 } }, city)).toBeNull()
    const out = exitHome({ ...inside, pos: room.door }, city)!
    expect(out.location).toEqual({ kind: 'outdoor' })
    expect(Math.hypot(out.pos.x - home.door.x, out.pos.z - home.door.z)).toBeLessThanOrEqual(DOOR_DISTANCE)
    expect(homeAt(city, home.id)).toBe(home)

    for (const h of city.homes) {
      const room2 = generateInterior(h)
      const inside2 = enterHome(at(h.door), city)!
      const exited = exitHome({ ...inside2, pos: room2.door }, city)!
      const outward = (exited.pos.x - h.door.x) * Math.sin(h.facing) + (exited.pos.z - h.door.z) * Math.cos(h.facing)
      expect(outward).toBeGreaterThan(0)
      expect(exited.heading).toBe(h.facing)
      expect(isFree(exited.pos, WALK_RADIUS, city.colliders)).toBe(true)
    }
  })
})

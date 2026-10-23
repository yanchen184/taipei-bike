import { describe, expect, test } from 'vitest'
import { isOnRoad } from '../sim/city'
import { DEFAULT_BUILD, bikeSpec } from '../sim/parts'
import { SAVE_KEY, loadSave } from '../sim/save'
import { GameEngine, type Storage } from './engine'

function memoryStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

describe('GameEngine 存檔', () => {
  test('[P2-1] 拜訪住家後 storage 立即寫入該戶，不等自動存檔間隔', () => {
    const storage = memoryStorage()
    const engine = new GameEngine({ seed: 3, name: '阿明', storage, now: () => 1000 })
    const home = engine.city.homes[0]!
    engine.teleport(home.door.x + Math.sin(home.facing), home.door.z + Math.cos(home.facing), home.facing + Math.PI)

    engine.action('interact')

    expect(engine.getHud().homeId).toBe(home.id)
    expect(loadSave(storage.data.get(SAVE_KEY) ?? null).save.visited).toEqual([home.id])
  })
})

const IDLE = { forward: 0, right: 0, run: false, handbrake: false }
const CHEAP = { ...DEFAULT_BUILD, frame: 'steel' }

function freeRoam() {
  const storage = memoryStorage()
  const engine = new GameEngine({ seed: 3, name: '阿明', storage, now: () => 1000 })
  return { engine, storage, player: () => engine.state.player }
}

describe('D6 自由騎車', () => {
  test('[D6-1] 步行在戶外按 B，腳踏車出現在最近的路面、玩家直接騎上去，性能是存檔組裝的性能', () => {
    const { engine, player } = freeRoam()
    engine.setBuild(CHEAP)
    engine.teleport(player().pos.x, player().pos.z)

    engine.action('summonBike')

    expect(player().mode).toBe('bike')
    expect(player().bike).not.toBeNull()
    expect(isOnRoad(engine.city, player().bike!.pos)).toBe(true)
    expect(player().pos).toEqual(player().bike!.pos)
    expect(player().bike!.speed).toBe(0)
    expect(player().bikeSpec).toEqual(bikeSpec(CHEAP))
    expect(engine.getHud().mode).toBe('bike')
  })

  test('[D6-2] 騎車時再召喚，舊車消失、新車出現，任何時候一個玩家只有一台腳踏車', () => {
    const { engine, player } = freeRoam()
    engine.action('summonBike')
    for (let k = 0; k < 90; k++) engine.update(1 / 30, { ...IDLE, forward: 1 })
    const ridden = player().bike!
    expect(ridden.speed).toBeGreaterThan(1)

    engine.action('summonBike')

    const bike = player().bike!
    expect(bike).not.toBe(ridden)
    expect(bike.speed).toBe(0)
    expect(isOnRoad(engine.city, bike.pos)).toBe(true)
    expect(player().mode).toBe('bike')
    expect(Object.values(player()).filter((v) => v === bike)).toHaveLength(1)
  })

  test('[D6-3] 騎車時按 E 下車，腳踏車收起不留在路上', () => {
    const { engine, player } = freeRoam()
    engine.action('summonBike')

    engine.action('interact')

    expect(player().mode).toBe('walk')
    expect(player().bike).toBeNull()
    expect(engine.getHud().mode).toBe('walk')
  })

  test('[D6-4] 開車中、室內召喚無效', () => {
    const { engine, player } = freeRoam()
    engine.action('interact')
    expect(player().mode).toBe('drive')
    engine.action('summonBike')
    expect(player().mode).toBe('drive')
    expect(player().bike).toBeNull()

    engine.action('interact')
    const home = engine.city.homes[0]!
    engine.teleport(home.door.x + Math.sin(home.facing), home.door.z + Math.cos(home.facing), home.facing + Math.PI)
    engine.action('interact')
    expect(player().location.kind).toBe('home')
    engine.action('summonBike')
    expect(player().mode).toBe('walk')
    expect(player().bike).toBeNull()
  })

  test('[D6-5] 騎車沒有時間限制，騎 10 分鐘後仍在騎', () => {
    const { engine, player } = freeRoam()
    engine.action('summonBike')
    for (let k = 0; k < 10 * 60 * 10; k++) engine.update(0.1, IDLE)
    expect(player().mode).toBe('bike')
    expect(player().bike).not.toBeNull()
  })
})

describe('D7 商店', () => {
  test('[D7-2] 裝上的組裝存進存檔，之後召喚的腳踏車用新組裝', () => {
    const { engine, storage, player } = freeRoam()

    engine.equip(CHEAP)

    expect(loadSave(storage.data.get(SAVE_KEY) ?? null).save.build).toEqual(CHEAP)
    expect(player().mode).toBe('walk')
    engine.action('summonBike')
    expect(player().bikeSpec).toEqual(bikeSpec(CHEAP))
  })

  test('[D7-3] 騎車時裝上，立刻換成新組裝的腳踏車，仍只有一台', () => {
    const { engine, player } = freeRoam()
    engine.action('summonBike')
    for (let k = 0; k < 30; k++) engine.update(1 / 30, { ...IDLE, forward: 1 })
    const before = player().bike!

    engine.equip(CHEAP)

    expect(player().mode).toBe('bike')
    expect(player().bikeSpec).toEqual(bikeSpec(CHEAP))
    expect(player().bike!.pos).toEqual(before.pos)
    expect(player().bike!.heading).toBe(before.heading)
    expect(player().bike!.speed).toBe(0)
  })
})

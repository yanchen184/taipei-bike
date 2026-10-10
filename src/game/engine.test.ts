import { describe, expect, test } from 'vitest'
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

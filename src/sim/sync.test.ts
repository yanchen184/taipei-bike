import { describe, expect, test } from 'vitest'
import { generateCity } from './city'
import { createPlayer, mountBike } from './player'
import {
  INTERP_DELAY,
  INTERP_KEEP,
  MAX_PLAYERS,
  OUTDOOR,
  ROOM_CODE_ALPHABET,
  SEND_INTERVAL,
  blankNetState,
  canSee,
  createSender,
  generateRoomCode,
  hostOf,
  interpolate,
  isRoomCode,
  isValidName,
  normalizeRoomCode,
  pushSample,
  sameNetState,
  slotsToTry,
  toNetState,
  worldTimeAt,
  writeInterpolated,
  type RemoteSample,
} from './sync'

function sample(at: number, x: number, h: number): RemoteSample {
  return { at, x, z: 0, h, mode: 'walk', cx: 0, cz: 0, ch: 0, loc: 'outdoor', l: 0 }
}

describe('M2 位置同步', () => {
  test('[M2-2] 位置上傳每秒不超過 10 次', () => {
    expect(SEND_INTERVAL).toBe(100)
    let sender = createSender()
    let sent = 0
    for (let now = 0; now < 1000; now += 16) {
      const r = sender.tick(now)
      sender = r.sender
      if (r.send) sent += 1
    }
    expect(sent).toBeLessThanOrEqual(10)
    expect(sent).toBeGreaterThanOrEqual(9)
  })

  test('[M2-3] 其他玩家的位置在兩次更新之間平滑補間', () => {
    const a = sample(1000, 0, Math.PI - 0.1)
    const b = sample(1100, 10, -Math.PI + 0.1)
    const mid = interpolate([a, b], 1050 + INTERP_DELAY)!
    expect(mid.x).toBeCloseTo(5)
    expect(Math.abs(Math.abs(mid.h) - Math.PI)).toBeLessThan(1e-9)
    expect(interpolate([a, b], 900 + INTERP_DELAY)!.x).toBe(0)
    expect(interpolate([a, b], 5000)!.x).toBe(10)
    const xs = [1010, 1030, 1060, 1090].map((t) => interpolate([a, b], t + INTERP_DELAY)!.x)
    xs.slice(1).forEach((x, k) => expect(x).toBeGreaterThan(xs[k]!))
    expect(interpolate([], 0)).toBeNull()

    const dupes = [sample(900, 0, 0), sample(1000, 4, 0), sample(1000, 6, 0), sample(1100, 8, 1), sample(1100, 9, 1)]
    for (let t = 850; t <= 1150; t += 5) {
      const r = interpolate(dupes, t + INTERP_DELAY)!
      expect([r.x, r.z, r.h, r.cx, r.cz, r.ch].every(Number.isFinite)).toBe(true)
    }
  })
})

describe('M1 房間（純規則）', () => {
  test('[M1-5] 暱稱必須是 2–12 字', () => {
    expect(isValidName('阿')).toBe(false)
    expect(isValidName('阿明')).toBe(true)
    expect(isValidName('一二三四五六七八九十壹貳')).toBe(true)
    expect(isValidName('一二三四五六七八九十壹貳參')).toBe(false)
    expect(isValidName('  ')).toBe(false)
    expect(isValidName('😀'.repeat(6))).toBe(true)
    expect(isValidName('😀'.repeat(7))).toBe(false)
  })
})

describe('M3 同戶可見', () => {
  test('[M3-1] 在同一戶室內的玩家互相看得到', () => {
    expect(canSee('h1', 'h1')).toBe(true)
    expect(canSee('outdoor', 'outdoor')).toBe(true)
  })

  test('[M3-2] 戶外與室內的玩家互相看不到', () => {
    expect(canSee('outdoor', 'h1')).toBe(false)
    expect(canSee('h1', 'outdoor')).toBe(false)
    expect(canSee('h1', 'h2')).toBe(false)
  })
})

describe('M4 離線', () => {
  test('[M4-2] 房主離開時房主交給最早加入的玩家', () => {
    const players = { a: { name: 'A', joinedAt: 5 }, b: { name: 'B', joinedAt: 3 }, c: { name: 'C', joinedAt: 9 } }
    expect(hostOf(players)).toBe('b')
    const rest = Object.fromEntries(Object.entries(players).filter(([uid]) => uid !== 'b'))
    expect(hostOf(rest)).toBe('a')
    expect(hostOf({})).toBeNull()
  })
})

describe('M1 房號與人數', () => {
  test('[M1-1] 房號是 4 碼、只用不易混淆的字元，輸入時忽略大小寫與空白', () => {
    const code = generateRoomCode([0, 1, 2, 31])
    expect(code).toHaveLength(4)
    expect(isRoomCode(code)).toBe(true)
    const n = ROOM_CODE_ALPHABET.length
    expect(generateRoomCode([n - 1, n, n + 1, 2 * n])).toBe(`${ROOM_CODE_ALPHABET[n - 1]}${ROOM_CODE_ALPHABET[0]}${ROOM_CODE_ALPHABET[1]}${ROOM_CODE_ALPHABET[0]}`)
    for (const ch of '0O1I') expect(ROOM_CODE_ALPHABET).not.toContain(ch)
    expect(normalizeRoomCode(' ab2c ')).toBe('AB2C')
    expect(isRoomCode('AB2')).toBe(false)
    expect(isRoomCode('AB0C')).toBe(false)
  })

  test('[M1-4] 房間有 6 個位子，全滿時沒有位子可占，已占位子的人沿用自己的位子', () => {
    expect(MAX_PLAYERS).toBe(6)
    expect(slotsToTry({}, 'a')).toEqual(['0', '1', '2', '3', '4', '5'])
    expect(slotsToTry({ '0': 'x', '2': 'y' }, 'a')).toEqual(['1', '3', '4', '5'])
    const full = Object.fromEntries(Array.from({ length: MAX_PLAYERS }, (_, k) => [String(k), `u${k}`]))
    expect(slotsToTry(full, 'new')).toEqual([])
    expect(slotsToTry(full, 'u3')).toEqual(['3'])
  })

  test('[M1-4] 位子的主人已不在玩家名單時，該位子視為空位；自己的舊位子優先沿用', () => {
    const slots = { '0': 'x', '1': 'gone', '2': 'y' }
    const players = { x: {}, y: {} }
    expect(slotsToTry(slots, 'a', players)).toEqual(['1', '3', '4', '5'])
    expect(slotsToTry(slots, 'gone', players)).toEqual(['1'])
    expect(slotsToTry(slots, 'a', { ...players, gone: {} })).toEqual(['3', '4', '5'])
  })
})

describe('M2 同步格式與補間', () => {
  test('[M2-1] 玩家狀態轉成同步格式，帶出步行／開車、車子與所在地點', () => {
    const p = createPlayer(generateCity(7))
    expect(toNetState(p)).toEqual({ x: p.pos.x, z: p.pos.z, h: p.heading, mode: 'walk', cx: p.car.pos.x, cz: p.car.pos.z, ch: p.car.heading, loc: OUTDOOR, l: 0 })
    expect(toNetState({ ...p, location: { kind: 'home', homeId: 'h3' } }).loc).toBe('h3')
  })

  test('[B2-6] 騎車時同步車身傾角，倒地時為 ±π/2；補間時傾角線性內插', () => {
    const p = createPlayer(generateCity(7))
    const down = mountBike(p, { pos: p.pos, heading: 0 })
    const lying = { ...down, bike: { ...down.bike!, lean: -Math.PI / 2, down: 2 } }
    expect(toNetState(lying).l).toBeCloseTo(-Math.PI / 2, 9)
    expect(toNetState(p).l).toBe(0)
    const a = { ...toNetState(down), at: 1000 }
    const b = { ...toNetState(lying), at: 1100 }
    expect(interpolate([a, b], 1050 + INTERP_DELAY)!.l).toBeCloseTo(-Math.PI / 4, 9)
    expect(sameNetState(a, { ...a, l: 0.2 })).toBe(false)
  })

  test('[M2-1] 世界時間 = 伺服器時間 − 房間建立時間（秒）', () => {
    expect(worldTimeAt(15_000, 5_000)).toBe(10)
    expect(worldTimeAt(4_000, 5_000)).toBe(0)
  })

  test('[M2-2] 狀態沒有變化時視為相同，不需要重送', () => {
    const a = toNetState(createPlayer(generateCity(7)))
    expect(sameNetState(a, { ...a })).toBe(true)
    expect(sameNetState(a, { ...a, x: a.x + 0.01 })).toBe(false)
    expect(sameNetState(a, { ...a, loc: 'h1' })).toBe(false)
    expect(sameNetState(null, a)).toBe(false)
  })

  test('[M2-3] 只保留最近兩筆狀態，補間寫進重用的物件、結果與 interpolate 相同', () => {
    expect(INTERP_KEEP).toBe(2)
    const s1 = sample(1000, 0, 0)
    const s2 = sample(1100, 10, 1)
    const s3 = sample(1200, 20, 2)
    const kept = pushSample(pushSample(pushSample([], s1), s2), s3)
    expect(kept).toEqual([s2, s3])
    const before = [s1]
    pushSample(before, s2)
    expect(before).toEqual([s1])

    const out = blankNetState()
    expect(writeInterpolated([], 0, out)).toBe(false)
    for (const t of [1000, 1150, 1250, 1400]) {
      expect(writeInterpolated(kept, t, out)).toBe(true)
      const { at: _at, ...expected } = { at: 0, ...interpolate(kept, t)! }
      expect(out).toEqual(expected)
    }
  })
})

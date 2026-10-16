import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { child, get, goOffline, goOnline, onValue, ref, update } from 'firebase/database'
import { OnlineSession, type RoomHandlers, type RoomLink } from '../../src/game/online'
import { RoomError } from '../../src/net/rooms'
import { generateCity } from '../../src/sim/city'
import { createPlayer } from '../../src/sim/player'
import { hostOf, type NetState, type RoomPlayer } from '../../src/sim/sync'
import { clearAppDatabase, closeClients, newClient, rulesEnv, type TestClient } from './client'

const nextCodes = vi.hoisted(() => [] as string[])

vi.mock('../../src/sim/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/sim/sync')>()
  return { ...actual, generateRoomCode: (values: ArrayLike<number>) => nextCodes.shift() ?? actual.generateRoomCode(values) }
})

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await rulesEnv()
})

beforeEach(async () => {
  nextCodes.length = 0
  await clearAppDatabase(env)
})

afterEach(closeClients)

afterAll(() => env.cleanup())

const STATE: NetState = { x: 1, z: 2, h: 0.5, mode: 'drive', cx: 1, cz: 2, ch: 0.5, loc: 'outdoor', l: 0 }

async function errorCode(task: Promise<unknown>): Promise<string> {
  try {
    await task
  } catch (e) {
    if (e instanceof RoomError) return e.code
    throw e
  }
  throw new Error('應該失敗卻成功了')
}

/** 監聽房間，把最新的名單與狀態記下來 */
function observe(link: RoomLink) {
  const seen = { players: {} as Record<string, RoomPlayer>, states: new Map<string, NetState>(), offset: null as number | null, errors: [] as Error[] }
  const handlers: RoomHandlers = {
    players: (players) => {
      seen.players = { ...players }
    },
    state: (uid, s) => {
      if (s) seen.states.set(uid, s)
      else seen.states.delete(uid)
    },
    serverOffset: (ms) => {
      seen.offset = ms
    },
  }
  const stop = link.watch(handlers, (e) => seen.errors.push(e))
  return { seen, stop }
}

async function until(check: () => boolean, timeout = 10_000): Promise<number> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`${timeout} ms 內沒有達成`)
    await new Promise((r) => setTimeout(r, 50))
  }
  return Date.now() - start
}

async function roomOfSix(): Promise<{ host: TestClient; code: string; clients: TestClient[]; links: RoomLink[] }> {
  const host = await newClient()
  const link = await host.rooms.createRoom(host.uid, '房主')
  const clients = await Promise.all(Array.from({ length: 5 }, () => newClient()))
  const links: RoomLink[] = []
  for (const [k, c] of clients.entries()) links.push(await c.rooms.joinRoom(link.code, c.uid, `玩家${k + 1}`))
  return { host, code: link.code, clients, links }
}

describe('M1 房間', () => {
  test('[M1-1] 建立房間取得 4 碼房號，建立者成為房主；房號已存在就重抽', async () => {
    const alice = await newClient()
    const link = await alice.rooms.createRoom(alice.uid, '阿明')
    expect(link.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/)
    expect(link.uid).toBe(alice.uid)
    expect(link.meta.creatorUid).toBe(alice.uid)
    expect(Math.abs(link.meta.createdAt - Date.now())).toBeLessThan(60_000)
    const players = (await get(ref(alice.db, `taipeiBike/rooms/${link.code}/players`))).val() as Record<string, RoomPlayer>
    expect(Object.keys(players)).toEqual([alice.uid])
    expect(hostOf(players)).toBe(alice.uid)

    const bob = await newClient()
    nextCodes.push(link.code, link.code, 'ZZ99')
    const second = await bob.rooms.createRoom(bob.uid, '小美')
    expect(second.code).toBe('ZZ99')
    expect(nextCodes).toEqual([])
    const kept = (await get(ref(alice.db, `taipeiBike/rooms/${link.code}/meta`))).val()
    expect(kept.creatorUid).toBe(alice.uid)
  })

  test('[M1-2] 輸入房號加入同一座城（同 seed），房號不分大小寫', async () => {
    const alice = await newClient()
    const bob = await newClient()
    const room = await alice.rooms.createRoom(alice.uid, '阿明')
    const joined = await bob.rooms.joinRoom(` ${room.code.toLowerCase()} `, bob.uid, '小美')
    expect(joined.code).toBe(room.code)
    expect(joined.meta).toEqual(room.meta)
    expect(Number.isInteger(room.meta.seed)).toBe(true)
  })

  test('[M1-3] 房號不存在時回報找不到房間', async () => {
    const bob = await newClient()
    expect(await errorCode(bob.rooms.joinRoom('ZZZZ', bob.uid, '小美'))).toBe('ROOM_NOT_FOUND')
    expect(await errorCode(bob.rooms.joinRoom('AB', bob.uid, '小美'))).toBe('ROOM_NOT_FOUND')
    expect(RoomError.of('ROOM_NOT_FOUND').message).toBe('找不到這個房間')
  })

  test('[M1-4] 房間已有 6 人時加入失敗並回報房間已滿', async () => {
    const { code } = await roomOfSix()
    const late = await newClient()
    expect(await errorCode(late.rooms.joinRoom(code, late.uid, '第七人'))).toBe('ROOM_FULL')
    expect(RoomError.of('ROOM_FULL').message).toContain('6')
  })

  test('[M1-4] 兩人同時搶最後一個位子，只有一人加入', async () => {
    const host = await newClient()
    const { code } = await host.rooms.createRoom(host.uid, '房主')
    const four = await Promise.all(Array.from({ length: 4 }, () => newClient()))
    for (const [k, c] of four.entries()) await c.rooms.joinRoom(code, c.uid, `玩家${k + 1}`)
    const racers = await Promise.all([newClient(), newClient()])
    const results = await Promise.allSettled(racers.map((c, k) => c.rooms.joinRoom(code, c.uid, `搶位${k}`)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason instanceof RoomError && rejected.reason.code).toBe('ROOM_FULL')
    const players = (await get(ref(host.db, `taipeiBike/rooms/${code}/players`))).val() as Record<string, RoomPlayer>
    expect(Object.keys(players)).toHaveLength(6)
  })

  test('[M1-5] 暱稱不是 2–12 字時不能建房或加入', async () => {
    const alice = await newClient()
    expect(await errorCode(alice.rooms.createRoom(alice.uid, '阿'))).toBe('BAD_NAME')
    const room = await alice.rooms.createRoom(alice.uid, '阿明')
    const bob = await newClient()
    expect(await errorCode(bob.rooms.joinRoom(room.code, bob.uid, '一二三四五六七八九十壹貳參'))).toBe('BAD_NAME')
    expect(await errorCode(bob.rooms.joinRoom(room.code, bob.uid, '😀'.repeat(7)))).toBe('BAD_NAME')
  })
})

describe('M2 位置同步（連線）', () => {
  test('[M2-1] 一位玩家送出的狀態會傳給同房的其他玩家，並取得伺服器時間差', async () => {
    const alice = await newClient()
    const bob = await newClient()
    const room = await alice.rooms.createRoom(alice.uid, '阿明')
    const bobLink = await bob.rooms.joinRoom(room.code, bob.uid, '小美')
    const { seen, stop } = observe(room)
    await bobLink.send(STATE)
    await until(() => seen.states.has(bob.uid))
    expect(seen.states.get(bob.uid)).toEqual(STATE)
    expect(Object.keys(seen.players).sort()).toEqual([alice.uid, bob.uid].sort())
    await until(() => seen.offset !== null)
    expect(seen.errors).toEqual([])
    stop()
  })
})

describe('M4 離線', () => {
  test('[M4-1] 玩家斷線後 10 秒內，他的玩家資料與狀態從房間移除', async () => {
    const alice = await newClient()
    const bob = await newClient()
    const room = await alice.rooms.createRoom(alice.uid, '阿明')
    const bobLink = await bob.rooms.joinRoom(room.code, bob.uid, '小美')
    const { seen, stop } = observe(room)
    await bobLink.send(STATE)
    await until(() => seen.states.has(bob.uid) && bob.uid in seen.players)

    goOffline(bob.db)
    const elapsed = await until(() => !seen.states.has(bob.uid) && !(bob.uid in seen.players))
    expect(elapsed).toBeLessThan(10_000)
    const node = await get(ref(alice.db, `taipeiBike/rooms/${room.code}`))
    expect(node.child(`players/${bob.uid}`).exists()).toBe(false)
    expect(node.child(`states/${bob.uid}`).exists()).toBe(false)
    const bobSlot = Object.entries((node.child('slots').val() ?? {}) as Record<string, string>).find(([, uid]) => uid === bob.uid)?.[0]
    const carol = await newClient()
    await carol.rooms.joinRoom(room.code, carol.uid, '小花')
    const slots = (await get(ref(alice.db, `taipeiBike/rooms/${room.code}/slots`))).val() as Record<string, string>
    expect(Object.values(slots)).not.toContain(bob.uid)
    if (bobSlot !== undefined) expect(slots[bobSlot]).toBe(carol.uid)
    stop()
  })

  test('[M4-2] 房主離開時房主交給最早加入的玩家', async () => {
    const { host, clients, links } = await roomOfSix()
    const { seen, stop } = observe(links[4]!)
    await until(() => Object.keys(seen.players).length === 6)
    expect(hostOf(seen.players)).toBe(host.uid)

    goOffline(host.db)
    await until(() => !(host.uid in seen.players))
    expect(hostOf(seen.players)).toBe(clients[0]!.uid)
    stop()
  })

  test('斷線重連後重新回到房間', async () => {
    const alice = await newClient()
    const bob = await newClient()
    const room = await alice.rooms.createRoom(alice.uid, '阿明')
    const bobLink = await bob.rooms.joinRoom(room.code, bob.uid, '小美')
    const session = new OnlineSession(bobLink)
    const standing = createPlayer(generateCity(room.meta.seed))
    const stopSession = session.start(() => standing)
    const { seen, stop } = observe(room)
    await until(() => bob.uid in seen.players && seen.states.has(bob.uid))

    goOffline(bob.db)
    await until(() => !(bob.uid in seen.players) && !seen.states.has(bob.uid))
    goOnline(bob.db)
    await until(() => bob.uid in seen.players && seen.states.has(bob.uid))
    expect(session.store.getError()).toBeNull()
    stopSession()
    stop()
  })

  test('[M4-1] 停止監聽後，進行中的重新加入不會留下位子與玩家資料', async () => {
    const alice = await newClient()
    const bob = await newClient()
    const room = await alice.rooms.createRoom(alice.uid, '阿明')
    const bobLink = await bob.rooms.joinRoom(room.code, bob.uid, '小美')
    const roomRef = ref(bob.db, `taipeiBike/rooms/${room.code}`)
    const slot = Object.entries(((await get(child(roomRef, 'slots'))).val() ?? {}) as Record<string, string>).find(([, uid]) => uid === bob.uid)![0]
    const bobWatch = observe(bobLink)
    let removed = false
    const unlisten = onValue(child(roomRef, `players/${bob.uid}`), (snap) => {
      if (snap.exists() || removed) return
      removed = true
      bobWatch.stop()
    })
    await update(roomRef, { [`slots/${slot}`]: null, [`players/${bob.uid}`]: null, [`states/${bob.uid}`]: null })
    await until(() => removed)
    await new Promise((r) => setTimeout(r, 2000))
    unlisten()
    const node = await get(ref(alice.db, `taipeiBike/rooms/${room.code}`))
    expect(node.child(`players/${bob.uid}`).exists()).toBe(false)
    expect(Object.values(node.child('slots').val() ?? {})).not.toContain(bob.uid)
    expect(bobWatch.seen.errors).toEqual([])
  })

  test('[M4-1] 重連時房間已滿會回報錯誤，之後有空位就自動回到房間', { timeout: 40_000 }, async () => {
    const alice = await newClient()
    const bob = await newClient()
    const room = await alice.rooms.createRoom(alice.uid, '阿明')
    const bobLink = await bob.rooms.joinRoom(room.code, bob.uid, '小美')
    const bobWatch = observe(bobLink)
    const { seen, stop } = observe(room)
    await until(() => bob.uid in seen.players)

    goOffline(bob.db)
    await until(() => !(bob.uid in seen.players))
    const others = await Promise.all(Array.from({ length: 5 }, () => newClient()))
    for (const [k, c] of others.entries()) await c.rooms.joinRoom(room.code, c.uid, `玩家${k + 1}`)
    goOnline(bob.db)
    await until(() => bobWatch.seen.errors.some((e) => e instanceof RoomError && e.code === 'ROOM_FULL'))

    goOffline(others[0]!.db)
    await until(() => bob.uid in seen.players, 15_000)
    expect(Object.keys(seen.players)).toHaveLength(6)
    bobWatch.stop()
    stop()
  })
})

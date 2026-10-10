import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import * as rtdb from 'firebase/database'
import { clearAppDatabase, closeClients, newClient, rulesEnv } from './client'

const calls = vi.hoisted(() => [] as string[])

vi.mock('firebase/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/database')>()
  const pathOf = (r: { toString(): string }) => new URL(r.toString()).pathname
  return {
    ...actual,
    update: vi.fn(async (r: rtdb.DatabaseReference, values: object) => {
      calls.push(`update ${pathOf(r)} ${Object.keys(values).sort().join(',')}`)
      return actual.update(r, values)
    }),
    set: vi.fn(async (r: rtdb.DatabaseReference, value: unknown) => {
      calls.push(`set ${pathOf(r)}`)
      return actual.set(r, value)
    }),
    onDisconnect: vi.fn((r: rtdb.DatabaseReference) => {
      const real = actual.onDisconnect(r)
      return {
        cancel: () => real.cancel(),
        remove: async () => {
          await real.remove()
          calls.push(`onDisconnect.remove ${pathOf(r)}`)
        },
        set: async (value: unknown) => {
          await real.set(value)
          calls.push(`onDisconnect.set ${pathOf(r)}`)
        },
        setWithPriority: (value: unknown, priority: number | string | null) => real.setWithPriority(value, priority),
        update: async (values: object) => {
          await real.update(values)
          calls.push(`onDisconnect.update ${pathOf(r)} ${Object.keys(values).sort().join(',')}`)
        },
      }
    }),
  }
})

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await rulesEnv()
})

beforeEach(async () => {
  calls.length = 0
  vi.mocked(rtdb.update).mockClear()
  await clearAppDatabase(env)
})

afterEach(closeClients)

afterAll(() => env.cleanup())

async function until(check: () => boolean | Promise<boolean>, timeout = 10_000): Promise<void> {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error(`${timeout} ms 內沒有達成`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('M4 離線（加入的寫入順序）', () => {
  test('[M4-1] 加入前先登記一筆斷線時移除玩家資料與狀態的更新，再一次寫入位子與玩家資料', async () => {
    const alice = await newClient()
    const link = await alice.rooms.createRoom(alice.uid, '阿明')
    const room = `/taipeiBike/rooms/${link.code}`
    const joinCalls = calls.filter((c) => !c.includes('/meta'))
    expect(joinCalls).toEqual([
      `onDisconnect.update ${room} players/${alice.uid},states/${alice.uid}`,
      `update ${room} players/${alice.uid},slots/0`,
    ])
  })
})

describe('M1 房間（建房失敗）', () => {
  test('[M1-1] 建房後加入失敗時刪除剛建立的 meta', async () => {
    const alice = await newClient()
    const failure = new Error('network down')
    vi.mocked(rtdb.update).mockImplementationOnce(async () => {
      throw failure
    })
    await expect(alice.rooms.createRoom(alice.uid, '阿明')).rejects.toBe(failure)
    const room = calls.find((c) => c.startsWith('onDisconnect.update '))!.split(' ')[1]!
    expect((await rtdb.get(rtdb.ref(alice.db, room))).val()).toBeNull()
  })
})

describe('M1 房間（位子）', () => {
  test('[M1-4] 斷線玩家留下的位子由下一位加入的玩家接手', async () => {
    const alice = await newClient()
    const bob = await newClient()
    const carol = await newClient()
    const link = await alice.rooms.createRoom(alice.uid, '阿明')
    const roomPath = `taipeiBike/rooms/${link.code}`
    await bob.rooms.joinRoom(link.code, bob.uid, '小美')
    rtdb.goOffline(bob.db)
    const bobPlayer = rtdb.ref(alice.db, `${roomPath}/players/${bob.uid}`)
    await until(async () => !(await rtdb.get(bobPlayer)).exists())
    await carol.rooms.joinRoom(link.code, carol.uid, '小花')
    const room = (await rtdb.get(rtdb.ref(alice.db, roomPath))).val() as { slots: Record<string, string>; players: object }
    expect({ ...room.slots }).toEqual({ '0': alice.uid, '1': carol.uid })
    expect(Object.keys(room.players).sort()).toEqual([alice.uid, carol.uid].sort())
  })

  test('[M1-4] 位子被搶走時換下一個位子，加入成功的人只占一個位子', async () => {
    const alice = await newClient()
    const link = await alice.rooms.createRoom(alice.uid, '阿明')
    const racers = await Promise.all([newClient(), newClient(), newClient()])
    await Promise.all(racers.map((c, k) => c.rooms.joinRoom(link.code, c.uid, `搶位${k}`)))
    const slots = (await rtdb.get(rtdb.ref(alice.db, `taipeiBike/rooms/${link.code}/slots`))).val() as Record<string, string>
    expect(Object.values(slots).sort()).toEqual([alice.uid, ...racers.map((c) => c.uid)].sort())
  })
})

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { rulesEnv } from './client'

let env: RulesTestEnvironment

const ROOM = 'taipeiBike/rooms/ABCD'
const RACE = `${ROOM}/race`
const NOW = { '.sv': 'timestamp' }

/** alice 最早加入（房主），bob、carol 依序加入；本局 n = 1，alice 與 bob 參賽，倒數已結束 */
const meta = { n: 1, ai: 2, cps: 6, at: 1, entrants: { alice: 0, bob: 1 } }
const aiNet = (n = 1) => ({ n, x: 1, z: 2, h: 0, s: 3, w: 1, cp: 0 })
const newRound = (n: number, entrants: Record<string, number> = { alice: 0, bob: 1 }) => ({
  meta: { n, ai: 2, cps: 6, at: NOW, entrants },
})

const db = (uid: string) => env.authenticatedContext(uid).database()
const progress = (uid: string) => db(uid).ref(`${RACE}/progress/${uid}`)

async function read(path: string): Promise<unknown> {
  let value: unknown = null
  await env.withSecurityRulesDisabled(async (ctx) => {
    value = (await ctx.database().ref(path).get()).val()
  })
  return value
}

async function seed(path: string, value: unknown): Promise<void> {
  await env.withSecurityRulesDisabled((ctx) => ctx.database().ref(path).set(value))
}

beforeAll(async () => {
  env = await rulesEnv()
})

beforeEach(async () => {
  await env.clearDatabase()
  await seed(ROOM, {
    meta: { seed: 7, creatorUid: 'alice', createdAt: 1 },
    slots: { '0': 'alice', '1': 'bob', '2': 'carol' },
    players: { alice: { name: '阿明', joinedAt: 1 }, bob: { name: '小美', joinedAt: 2 }, carol: { name: '阿花', joinedAt: 3 } },
    race: { meta },
  })
})

afterAll(() => env.cleanup())

describe('N2 比賽安全規則', () => {
  test('[N2-1] 只有房主能開新的一局或刪除比賽，開新局時清掉上一局的進度與 AI', async () => {
    await seed(`${RACE}/progress/bob`, { n: 1, cp: 2 })
    await seed(`${RACE}/ai/0`, aiNet())
    await assertFails(db('bob').ref(RACE).set(newRound(2)))
    await assertFails(db('alice').ref(RACE).set({ ...newRound(2), progress: { alice: { n: 2, cp: 1 } } }))
    await assertFails(db('alice').ref(RACE).set({ ...newRound(2), ai: { '0': aiNet(2) } }))
    await assertFails(db('alice').ref(RACE).set(newRound(3)))
    await assertSucceeds(db('alice').ref(RACE).set(newRound(2)))
    expect(await read(`${RACE}/progress`)).toBeNull()
    expect(await read(`${RACE}/ai`)).toBeNull()
    await assertFails(db('bob').ref(RACE).remove())
    await assertSucceeds(db('alice').ref(RACE).remove())
  })

  test('[N2-1] 開賽資料：AI 0–5、檢查點 6–8、開賽時間是伺服器時間、參賽者在房內', async () => {
    const start = (m: object) => db('alice').ref(RACE).set({ meta: { ...newRound(2).meta, ...m } })
    await assertFails(start({ ai: 6 }))
    await assertFails(start({ ai: -1 }))
    await assertFails(start({ cps: 5 }))
    await assertFails(start({ cps: 9 }))
    await assertFails(start({ at: 1 }))
    await assertFails(start({ entrants: { alice: 0, mallory: 1 } }))
    await assertFails(start({ entrants: { alice: 6 } }))
    await assertFails(start({ extra: 1 }))
    await assertSucceeds(start({ ai: 5, cps: 8, entrants: { alice: 0, bob: 1, carol: 2 } }))
  })

  test('[N2-1] 房主離開後，下一位最早加入的玩家成為房主', async () => {
    await assertFails(db('bob').ref(RACE).set(newRound(2)))
    await seed(`${ROOM}/players/alice`, null)
    await seed(`${ROOM}/slots/0`, null)
    await assertSucceeds(db('bob').ref(RACE).set(newRound(2, { bob: 0 })))
  })

  test('[N2-1] 只有房主能寫 AI；編號要小於本局 AI 數，局數要是目前這局', async () => {
    await assertFails(db('bob').ref(`${RACE}/ai/0`).set(aiNet()))
    await assertFails(db('alice').ref(`${RACE}/ai/2`).set(aiNet()))
    await assertFails(db('alice').ref(`${RACE}/ai/0`).set(aiNet(2)))
    await assertSucceeds(db('alice').ref(RACE).update({ 'ai/0': aiNet(), 'ai/1': aiNet() }))
  })

  test('[N2-1] AI 的完成時間必須是伺服器時間，寫入後不能改也不能刪', async () => {
    await assertFails(db('alice').ref(`${RACE}/ai/0`).set({ ...aiNet(), fin: 5 }))
    await assertSucceeds(db('alice').ref(`${RACE}/ai/0`).set({ ...aiNet(), fin: NOW }))
    const fin = (await read(`${RACE}/ai/0/fin`)) as number
    await assertFails(db('alice').ref(`${RACE}/ai/0`).set({ ...aiNet(), fin: NOW }))
    await assertFails(db('alice').ref(`${RACE}/ai/0`).set(aiNet()))
    await assertSucceeds(db('alice').ref(`${RACE}/ai/0`).set({ ...aiNet(), x: 9, fin }))
  })

  test('[N2-2] 玩家只能寫自己的進度，檢查點一次加一，局數必須是目前這局', async () => {
    await assertFails(db('alice').ref(`${RACE}/progress/bob`).set({ n: 1, cp: 1 }))
    await assertFails(progress('bob').set({ n: 1, cp: 2 }))
    await assertFails(progress('bob').set({ n: 2, cp: 1 }))
    await assertFails(progress('bob').set({ n: 1, cp: 1, extra: 1 }))
    await assertSucceeds(progress('bob').set({ n: 1, cp: 1 }))
    await assertFails(progress('bob').set({ n: 1, cp: 1 }))
    await assertFails(progress('bob').set({ n: 1, cp: 3 }))
    await assertSucceeds(progress('bob').set({ n: 1, cp: 2 }))
    await assertFails(progress('bob').remove())
    await seed(`${RACE}/progress/bob`, { n: 1, cp: 6 })
    await assertFails(progress('bob').set({ n: 1, cp: 7 }))
  })

  test('[N2-3] 倒數結束前不能寫進度', async () => {
    await assertSucceeds(db('alice').ref(RACE).set(newRound(2)))
    await assertFails(progress('bob').set({ n: 2, cp: 1 }))
  })

  test('[N2-3] 完成時間必須是伺服器時間，而且只有通過全部檢查點時才能寫', async () => {
    await assertFails(progress('bob').set({ n: 1, cp: 1, fin: NOW }))
    await seed(`${RACE}/progress/bob`, { n: 1, cp: 5 })
    await assertFails(progress('bob').set({ n: 1, cp: 6, fin: 12345 }))
    await assertSucceeds(progress('bob').set({ n: 1, cp: 6, fin: NOW }))
  })

  test('[N2-4] 只有開賽時在場的參賽者能寫進度', async () => {
    await assertFails(progress('carol').set({ n: 1, cp: 1 }))
    await assertFails(progress('mallory').set({ n: 1, cp: 1 }))
    await seed(`${ROOM}/players/bob`, null)
    await assertFails(progress('bob').set({ n: 1, cp: 1 }))
    await assertSucceeds(progress('alice').set({ n: 1, cp: 1 }))
  })

  test('騎腳踏車時狀態的 mode 是 bike', async () => {
    const state = { x: 1, z: 2, h: 0, cx: 3, cz: 4, ch: 0, loc: 'outdoor', t: NOW }
    await assertSucceeds(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, mode: 'bike' }))
    await assertFails(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, mode: 'fly' }))
  })
})

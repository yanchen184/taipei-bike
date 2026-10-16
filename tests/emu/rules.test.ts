import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { rulesEnv } from './client'

let env: RulesTestEnvironment

const ROOM = 'taipeiBike/rooms/ABCD'
const NOW = { '.sv': 'timestamp' }

const meta = (creatorUid: string) => ({ seed: 7, creatorUid, createdAt: NOW })
const player = (name: string) => ({ name, joinedAt: NOW })
const state = { x: 1, z: 2, h: 0, mode: 'walk', cx: 3, cz: 4, ch: 0, loc: 'outdoor' }

const db = (uid: string) => env.authenticatedContext(uid).database()
const anon = () => env.unauthenticatedContext().database()
const claim = (uid: string, slot: string) => db(uid).ref(`${ROOM}/slots/${slot}`).set(uid)
/** App 加入房間的寫法：位子與玩家資料一次寫入 */
const join = (uid: string, slot: string, profile: object = player('小美')) =>
  db(uid).ref(ROOM).update({ [`slots/${slot}`]: uid, [`players/${uid}`]: profile })
/** App 離開房間的寫法：位子、玩家資料、狀態一次移除 */
const leave = (uid: string, slot: string) =>
  db(uid).ref(ROOM).update({ [`slots/${slot}`]: null, [`players/${uid}`]: null, [`states/${uid}`]: null })

async function roomCounts(): Promise<{ slots: number; players: number }> {
  let counts = { slots: 0, players: 0 }
  await env.withSecurityRulesDisabled(async (ctx) => {
    const room = (await ctx.database().ref(ROOM).get()).val() as { slots?: object; players?: object }
    counts = { slots: Object.keys(room.slots ?? {}).length, players: Object.keys(room.players ?? {}).length }
  })
  return counts
}

beforeAll(async () => {
  env = await rulesEnv()
})

beforeEach(async () => {
  await env.clearDatabase()
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref(ROOM).set({
      meta: { seed: 7, creatorUid: 'alice', createdAt: 1 },
      slots: { '0': 'alice' },
      players: { alice: { name: '阿明', joinedAt: 1 } },
      states: { alice: { ...state, t: 1 } },
    })
  })
})

afterAll(() => env.cleanup())

describe('M5 安全規則', () => {
  test('[M5-1] 未登入不能讀寫房間', async () => {
    await assertFails(anon().ref(ROOM).get())
    await assertFails(anon().ref(`${ROOM}/meta`).get())
    await assertFails(anon().ref('taipeiBike/rooms/NEW1/meta').set(meta('x')))
    await assertFails(anon().ref(`${ROOM}/players/x`).set(player('路人')))
    await assertFails(anon().ref(`${ROOM}/slots/1`).set('x'))
    await assertSucceeds(db('bob').ref(ROOM).get())
  })

  test('[M5-2] 玩家只能寫自己的玩家資料、狀態與位子', async () => {
    await assertFails(db('bob').ref(ROOM).update({ 'slots/1': 'alice', 'players/bob': player('小美') }))
    await assertFails(join('bob', '0'))
    await assertFails(db('bob').ref(`${ROOM}/slots/0`).remove())
    await assertSucceeds(join('bob', '1'))
    await assertSucceeds(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, t: NOW }))
    await assertFails(db('bob').ref(`${ROOM}/players/alice`).set(player('冒名')))
    await assertFails(db('bob').ref(`${ROOM}/players/alice`).remove())
    await assertFails(db('bob').ref(`${ROOM}/states/alice`).set({ ...state, t: NOW }))
    await assertFails(db('bob').ref(`${ROOM}/states/alice`).remove())
    await assertFails(db('bob').ref(`${ROOM}/players`).set({ bob: player('小美') }))
    await assertFails(leave('bob', '0'))
    await assertSucceeds(leave('alice', '0'))
    expect(await roomCounts()).toEqual({ slots: 1, players: 1 })
  })

  test('[M5-2] 加入前可以先登記斷線時移除自己的玩家資料與狀態，不能登記移除別人的', async () => {
    await assertSucceeds(db('bob').ref(ROOM).update({ 'players/bob': null, 'states/bob': null }))
    await assertFails(db('bob').ref(ROOM).update({ 'players/alice': null, 'states/alice': null }))
    await assertFails(leave('bob', '0'))
    await assertFails(db('bob').ref(`${ROOM}/slots/6`).remove())
  })

  test('[M5-3] 不能改房間的 seed 與建立者，也不能刪除房間', async () => {
    await assertFails(db('alice').ref(`${ROOM}/meta/seed`).set(8))
    await assertFails(db('alice').ref(`${ROOM}/meta/creatorUid`).set('bob'))
    await assertFails(db('bob').ref(`${ROOM}/meta`).set(meta('bob')))
    await assertFails(db('alice').ref(`${ROOM}/meta`).remove())
    await assertFails(db('alice').ref(ROOM).remove())
    await assertFails(db('bob').ref('taipeiBike/rooms/NEW1/meta').set(meta('alice')))
    await assertFails(db('bob').ref('taipeiBike/rooms/NEW1/meta').set({ seed: 7, creatorUid: 'bob', createdAt: 5 }))
    await assertFails(db('bob').ref('taipeiBike/rooms/NEW1/meta').set({ ...meta('bob'), extra: 1 }))
    await assertSucceeds(db('bob').ref('taipeiBike/rooms/NEW1/meta').set(meta('bob')))
  })

  test('[M5-3] 房間沒有人時，只有建立者能刪除 meta', async () => {
    await assertSucceeds(join('bob', '1'))
    await assertSucceeds(leave('alice', '0'))
    await assertFails(db('alice').ref(`${ROOM}/meta`).remove())
    await assertSucceeds(leave('bob', '1'))
    await assertFails(db('bob').ref(`${ROOM}/meta`).remove())
    await assertSucceeds(db('alice').ref(`${ROOM}/meta`).remove())
  })

  test('玩家資料與狀態的格式錯誤會被拒絕', async () => {
    await assertFails(join('bob', '1', { name: '小美', joinedAt: 5 }))
    await assertFails(join('bob', '1', { ...player('小美'), admin: true }))
    await assertSucceeds(join('bob', '1'))
    await assertFails(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, t: NOW, mode: 'fly' }))
    await assertFails(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, t: NOW, x: 'far' }))
    await assertFails(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, t: 5 }))
    await assertFails(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, t: NOW, extra: 1 }))
  })

  test('[B2-6] 狀態可以帶車身傾角 l（-1.6–1.6，倒地為 ±π/2），不帶也可以', async () => {
    await assertSucceeds(join('bob', '1'))
    await assertSucceeds(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, mode: 'bike', l: Math.PI / 2, t: NOW }))
    await assertSucceeds(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, mode: 'bike', l: -0.4, t: NOW }))
    await assertSucceeds(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, t: NOW }))
    await assertFails(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, l: 2, t: NOW }))
    await assertFails(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, l: 'down', t: NOW }))
  })

  test('沒占位子不能加入，沒加入不能寫狀態，房間不存在不能占位子', async () => {
    await assertFails(db('bob').ref(`${ROOM}/players/bob`).set(player('小美')))
    await assertFails(claim('bob', '1'))
    await assertFails(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, t: NOW }))
    await assertFails(db('bob').ref('taipeiBike/rooms/NONE').update({ 'slots/0': 'bob', 'players/bob': player('小美') }))
  })
})

describe('M1 房間（規則）', () => {
  test('[M1-4] 6 個位子都被占時規則拒絕第 7 人；有人離開空出位子後才能加入', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const others = ['p1', 'p2', 'p3', 'p4', 'p5']
      await ctx.database().ref(ROOM).update({
        ...Object.fromEntries(others.map((uid, k) => [`slots/${k + 1}`, uid])),
        ...Object.fromEntries(others.map((uid, k) => [`players/${uid}`, { name: `玩家${uid}`, joinedAt: k + 2 }])),
      })
    })
    for (const slot of ['0', '1', '5']) await assertFails(join('mallory', slot, player('第七人')))
    await assertFails(join('mallory', '6', player('第七人')))
    await assertFails(join('mallory', 'x', player('第七人')))
    await assertFails(db('mallory').ref(`${ROOM}/players/mallory`).set(player('第七人')))
    await assertSucceeds(db('p3').ref(`${ROOM}/players/p3`).set(player('換名字')))
    await assertFails(db('p5').ref(`${ROOM}/slots/5`).remove())
    await assertSucceeds(leave('p5', '5'))
    await assertSucceeds(join('mallory', '5', player('第六人')))
    await assertFails(join('p5', '5', player('回來')))
    expect(await roomCounts()).toEqual({ slots: 6, players: 6 })
  })

  test('[M1-4] 釋放位子後不能保留或再寫玩家資料與狀態', async () => {
    await assertSucceeds(join('bob', '1'))
    await assertSucceeds(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, t: NOW }))
    await assertFails(db('bob').ref(`${ROOM}/slots/1`).remove())
    await assertFails(db('bob').ref(ROOM).update({ 'slots/1': null, 'states/bob': null }))
    await assertFails(db('bob').ref(ROOM).update({ 'slots/1': 'carol', 'players/bob': player('小美') }))
    await assertSucceeds(leave('bob', '1'))
    await assertFails(db('bob').ref(`${ROOM}/players/bob`).set(player('小美')))
    await assertFails(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, t: NOW }))
    expect(await roomCounts()).toEqual({ slots: 1, players: 1 })
  })

  test('[M1-4] 位子的主人已沒有玩家資料時，位子可以被別人接手；主人還在時不行', async () => {
    await assertSucceeds(join('bob', '1'))
    await assertFails(join('carol', '1', player('小花')))
    await assertSucceeds(db('bob').ref(ROOM).update({ 'players/bob': null, 'states/bob': null }))
    await assertFails(db('bob').ref(`${ROOM}/states/bob`).set({ ...state, t: NOW }))
    await assertSucceeds(join('carol', '1', player('小花')))
    await assertFails(db('bob').ref(ROOM).update({ 'slots/1': 'bob', 'players/bob': player('小美') }))
    expect(await roomCounts()).toEqual({ slots: 2, players: 2 })
  })

  test('[M1-4] 同一位玩家不能占第二個位子', async () => {
    await assertSucceeds(join('bob', '1'))
    await assertFails(claim('bob', '2'))
    await assertFails(join('bob', '2'))
    await assertFails(join('alice', '4', player('阿明')))
    await assertFails(db('carol').ref(ROOM).update({ 'slots/2': 'carol', 'slots/3': 'carol', 'players/carol': player('小花') }))
    await assertSucceeds(db('bob').ref(`${ROOM}/slots/1`).set('bob'))
    expect(await roomCounts()).toEqual({ slots: 2, players: 2 })
  })

  test('[M1-5] 規則拒絕少於 2 字或多於 12 字的暱稱', async () => {
    await assertFails(join('bob', '1', player('阿')))
    await assertFails(join('bob', '1', player('一二三四五六七八九十壹貳參')))
    await assertFails(join('bob', '1', { name: 12, joinedAt: NOW }))
    await assertFails(join('bob', '1', player('😀'.repeat(7))))
    await assertSucceeds(join('bob', '1', player('一二三四五六七八九十壹貳')))
  })

  test('[M1-5] 規則拒絕全空白或前後有空白的暱稱', async () => {
    const bad = ['   ', '　　', ' 阿明', '阿明 ', '\t阿明', ' 阿明', '\n阿明', '阿明\r', ' 阿明', '阿明 ', '﻿阿明', ' 阿 ']
    for (const name of bad) await assertFails(join('bob', '1', player(name)))
    await assertSucceeds(join('bob', '1', player('阿 明')))
  })
})

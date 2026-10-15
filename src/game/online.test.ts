import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { generateCity } from '../sim/city'
import { createPlayer, type PlayerState } from '../sim/player'
import { OUTDOOR, SEND_INTERVAL, type NetState, type RoomPlayer } from '../sim/sync'
import { OnlineSession, type RoomHandlers, type RoomLink } from './online'

const BASE = createPlayer(generateCity(7))

/** reply 決定每次上傳的結果，預設立即成功；sent 記錄每次上傳嘗試 */
function fakeLink(reply: (state: NetState) => Promise<void> = async () => undefined) {
  const sent: NetState[] = []
  let handlers: RoomHandlers | null = null
  let onError: ((e: Error) => void) | null = null
  const link: RoomLink = {
    code: 'ABCD',
    uid: 'me',
    meta: { seed: 7, creatorUid: 'me', createdAt: 1_000_000 },
    race: {
      watch: () => () => undefined,
      start: async () => undefined,
      sendProgress: async () => undefined,
      sendAi: async () => undefined,
      sendBuild: async () => undefined,
    },
    send: (state) => {
      sent.push(state)
      return reply(state)
    },
    watch: (h, e) => {
      handlers = h
      onError = e
      return () => {
        handlers = null
      }
    },
  }
  return {
    link,
    sent,
    emit: () => {
      if (!handlers) throw new Error('沒有在監聽')
      return handlers
    },
    fail: (e: Error) => onError?.(e),
    watching: () => handlers !== null,
  }
}

function net(x: number, loc = OUTDOOR): NetState {
  return { x, z: 0, h: 0, mode: 'walk', cx: 0, cz: 0, ch: 0, loc }
}

const players = (entries: [string, string, number][]): Record<string, RoomPlayer> =>
  Object.fromEntries(entries.map(([uid, name, joinedAt]) => [uid, { name, joinedAt }]))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(2_000_000)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('M2 位置同步（連線中）', () => {
  test('[M2-2] 連線中位置上傳每秒不超過 10 次，靜止時不重送', async () => {
    const f = fakeLink()
    const session = new OnlineSession(f.link, { now: () => Date.now() })
    let player: PlayerState = BASE
    const stop = session.start(() => player)
    for (let k = 0; k < 100; k++) {
      player = { ...player, pos: { x: BASE.pos.x + k, z: BASE.pos.z } }
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(f.sent.length).toBeLessThanOrEqual(10)
    expect(f.sent.length).toBeGreaterThanOrEqual(8)
    const gaps = f.sent.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.sent.length).toBe(gaps + 1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.sent.length).toBe(gaps + 1)
    stop()
    player = { ...player, pos: { x: 0, z: 0 } }
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.sent.length).toBe(gaps + 1)
    expect(f.watching()).toBe(false)
  })

  test('[M2-2] 上傳失敗時顯示錯誤，之後重送同一個狀態直到成功，成功後清除錯誤', async () => {
    let failures = 2
    const f = fakeLink(async () => {
      if (failures-- > 0) throw new Error('network down')
    })
    const session = new OnlineSession(f.link, { now: () => Date.now() })
    let player: PlayerState = BASE
    session.start(() => player)
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL / 2)
    expect(f.sent).toHaveLength(1)
    expect(session.store.getError()).toContain('network down')
    player = { ...player, pos: { x: BASE.pos.x + 5, z: BASE.pos.z } }
    await vi.advanceTimersByTimeAsync(SEND_INTERVAL * 2)
    expect(f.sent).toHaveLength(3)
    expect(f.sent.every((s) => s.x === BASE.pos.x)).toBe(true)
    expect(session.store.getError()).toBeNull()
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.sent).toHaveLength(4)
    expect(f.sent[3]!.x).toBe(BASE.pos.x + 5)
  })

  test('[M2-2] 上一筆上傳還沒完成時不會再送', async () => {
    const pending: (() => void)[] = []
    const f = fakeLink(() => new Promise<void>((resolve) => pending.push(resolve)))
    const session = new OnlineSession(f.link, { now: () => Date.now() })
    let player: PlayerState = BASE
    session.start(() => player)
    for (let k = 0; k < 20; k++) {
      player = { ...player, pos: { x: BASE.pos.x + k, z: BASE.pos.z } }
      await vi.advanceTimersByTimeAsync(50)
    }
    expect(f.sent).toHaveLength(1)
    pending.shift()!()
    await vi.advanceTimersByTimeAsync(200)
    expect(f.sent).toHaveLength(2)
    expect(f.sent[1]!.x).toBe(player.pos.x)
  })

  test('[M2-1] 其他玩家的狀態進入畫面清單，自己不在清單內；世界時間用伺服器時間校正', () => {
    const f = fakeLink()
    const session = new OnlineSession(f.link, { now: () => Date.now() })
    session.start(() => BASE)
    const h = f.emit()
    h.players(players([['me', '我', 1], ['b', '小美', 2]]))
    expect(session.store.getRemotes()).toEqual([])
    h.state('b', net(5))
    h.state('me', net(9))
    expect(session.store.getRemotes()).toEqual([{ uid: 'b', name: '小美', loc: OUTDOOR }])
    expect(session.store.samplesOf('b').at(-1)).toMatchObject({ x: 5, at: 2_000_000 })

    expect(session.worldTime()).toBe(1000)
    h.serverOffset(5000)
    expect(session.worldTime()).toBe(1005)
  })

  test('[M2-3] 只有位置變化時不重建畫面清單，地點變化時才重建', () => {
    const f = fakeLink()
    const session = new OnlineSession(f.link, { now: () => Date.now() })
    session.start(() => BASE)
    const h = f.emit()
    h.players(players([['me', '我', 1], ['b', '小美', 2]]))
    h.state('b', net(1))
    const listener = vi.fn()
    session.store.subscribe(listener)
    const before = session.store.getRemotes()
    h.state('b', net(2))
    h.state('b', net(3))
    expect(listener).not.toHaveBeenCalled()
    expect(session.store.getRemotes()).toBe(before)
    expect(session.store.samplesOf('b').map((s) => s.x)).toEqual([2, 3])
    h.state('b', net(3, 'h1'))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(session.store.getRemotes()[0]?.loc).toBe('h1')
  })
})

describe('M4 離線（客戶端）', () => {
  test('[M4-1] 玩家節點被移除後從其他人的畫面清單消失', () => {
    const f = fakeLink()
    const session = new OnlineSession(f.link, { now: () => Date.now() })
    session.start(() => BASE)
    const h = f.emit()
    h.players(players([['me', '我', 1], ['b', '小美', 2]]))
    h.state('b', net(1))
    expect(session.store.getRemotes()).toHaveLength(1)
    h.state('b', null)
    h.players(players([['me', '我', 1]]))
    expect(session.store.getRemotes()).toEqual([])
    expect(session.store.samplesOf('b')).toEqual([])
  })

  test('[M4-2] 名單標示房主，房主離開後換最早加入的玩家', () => {
    const f = fakeLink()
    const session = new OnlineSession(f.link, { now: () => Date.now() })
    session.start(() => BASE)
    const h = f.emit()
    h.players(players([['c', '阿華', 30], ['me', '我', 20], ['a', '阿明', 10]]))
    expect(session.store.getRoster()).toEqual([
      { uid: 'a', name: '阿明', host: true, me: false },
      { uid: 'me', name: '我', host: false, me: true },
      { uid: 'c', name: '阿華', host: false, me: false },
    ])
    h.players(players([['c', '阿華', 30], ['me', '我', 20]]))
    expect(session.store.getRoster()[0]).toEqual({ uid: 'me', name: '我', host: true, me: true })
  })

  test('[M4-1] 自己被移出房間期間不上傳；重新加入後靜止的玩家也會重送狀態', async () => {
    const f = fakeLink()
    const session = new OnlineSession(f.link, { now: () => Date.now() })
    session.start(() => BASE)
    const h = f.emit()
    h.players(players([['me', '我', 1]]))
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.sent).toHaveLength(1)
    h.players({})
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.sent).toHaveLength(1)
    h.players(players([['me', '我', 5]]))
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.sent).toHaveLength(2)
    expect(f.sent[1]).toEqual(f.sent[0])
  })

  test('[M4-1] 重新加入失敗的錯誤在重新加入成功後清除', () => {
    const f = fakeLink()
    const session = new OnlineSession(f.link, { now: () => Date.now() })
    session.start(() => BASE)
    const h = f.emit()
    h.players(players([['me', '我', 1]]))
    h.players({})
    f.fail(new Error('房間已滿（6 人）'))
    expect(session.store.getError()).toContain('房間已滿')
    h.players(players([['me', '我', 5]]))
    expect(session.store.getError()).toBeNull()
  })

  test('[M4-1] 移出房間前送出、重新加入後才完成的上傳不算數，仍會重送', async () => {
    const pending: (() => void)[] = []
    const f = fakeLink(() => new Promise<void>((resolve) => pending.push(resolve)))
    const session = new OnlineSession(f.link, { now: () => Date.now() })
    session.start(() => BASE)
    const h = f.emit()
    h.players(players([['me', '我', 1]]))
    await vi.advanceTimersByTimeAsync(200)
    expect(f.sent).toHaveLength(1)
    h.players({})
    h.players(players([['me', '我', 5]]))
    pending.shift()!()
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.sent).toHaveLength(2)
  })

  test('[M4-1] 移出房間後才被拒絕的上傳不顯示錯誤，重新加入後重送', async () => {
    const pending: ((error?: Error) => void)[] = []
    const f = fakeLink(() => new Promise<void>((resolve, reject) => pending.push((e) => (e ? reject(e) : resolve()))))
    const session = new OnlineSession(f.link, { now: () => Date.now() })
    session.start(() => BASE)
    const h = f.emit()
    h.players(players([['me', '我', 1]]))
    await vi.advanceTimersByTimeAsync(200)
    expect(f.sent).toHaveLength(1)
    h.players({})
    pending.shift()!(new Error('PERMISSION_DENIED: Permission denied'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(session.store.getError()).toBeNull()
    expect(f.sent).toHaveLength(1)
    h.players(players([['me', '我', 5]]))
    await vi.advanceTimersByTimeAsync(200)
    expect(f.sent).toHaveLength(2)
  })

  test('連線錯誤會顯示給玩家', () => {
    const f = fakeLink()
    const session = new OnlineSession(f.link, { now: () => Date.now() })
    session.start(() => BASE)
    expect(session.store.getError()).toBeNull()
    f.fail(new Error('permission_denied'))
    expect(session.store.getError()).toContain('permission_denied')
  })
})

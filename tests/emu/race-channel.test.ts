import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import type { RoomLink } from '../../src/game/online'
import type { RaceSnapshot } from '../../src/modes/race/link'
import { COUNTDOWN_MS, PREP_MS, type AiNet } from '../../src/sim/race'
import { APP_DATABASE_URL, clearAppDatabase, closeClients, newClient, rulesEnv } from './client'

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await rulesEnv()
})

beforeEach(() => clearAppDatabase(env))

afterEach(closeClients)

afterAll(() => env.cleanup())

async function until(check: () => boolean, timeout = 10_000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error(`${timeout} ms 內沒有達成`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

function observe(link: RoomLink) {
  const seen = { snap: null as RaceSnapshot | null, errors: [] as Error[] }
  const stop = link.race.watch(
    (snap) => {
      seen.snap = snap
    },
    (e) => seen.errors.push(e),
  )
  return { seen, stop }
}

async function twoPlayers() {
  const alice = await newClient()
  const bob = await newClient()
  const host = await alice.rooms.createRoom(alice.uid, '阿明')
  const guest = await bob.rooms.joinRoom(host.code, bob.uid, '小美')
  return { host, guest }
}

/** 把這一局的開賽時間往前推 ms，模擬時間已經過去 */
async function backdate(code: string, ms: number): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const at = ctx.database(APP_DATABASE_URL).ref(`taipeiBike/rooms/${code}/race/meta/at`)
    await at.set(((await at.get()).val() as number) - ms)
  })
}

const aiNet = (n: number, x: number): AiNet => ({ n, x, z: 2, h: 0.5, s: 3, w: 1, cp: 0 })

describe('N1 比賽同步', () => {
  test('沒有比賽時收到空的比賽資料；房主開賽後局數從 1 遞增，開賽時間是伺服器時間', async () => {
    const { host, guest } = await twoPlayers()
    const watcher = observe(guest)
    await until(() => watcher.seen.snap !== null)
    expect(watcher.seen.snap).toEqual({ meta: null, progress: {}, ai: {}, build: {} })

    await host.race.start(2, () => 6, { [host.uid]: 0, [guest.uid]: 1 })
    await until(() => watcher.seen.snap?.meta?.n === 1)
    const meta = watcher.seen.snap!.meta!
    expect(meta).toMatchObject({ n: 1, ai: 2, cps: 6, entrants: { [host.uid]: 0, [guest.uid]: 1 } })
    expect(Math.abs(meta.at - Date.now())).toBeLessThan(60_000)

    await host.race.start(0, () => 7, { [host.uid]: 0 })
    await until(() => watcher.seen.snap?.meta?.n === 2)
    expect(watcher.seen.snap!.meta).toMatchObject({ ai: 0, cps: 7, entrants: { [host.uid]: 0 } })
    expect(watcher.seen.errors).toEqual([])
    watcher.stop()
  })

  test('[G1-4] 開新一局的檢查點數依伺服器上實際的局數計算', async () => {
    const { host, guest } = await twoPlayers()
    await host.race.start(0, () => 6, { [host.uid]: 0 })
    const watcher = observe(guest)
    await until(() => watcher.seen.snap?.meta?.n === 1)

    await host.race.start(0, (n) => (n === 2 ? 8 : 7), { [host.uid]: 0 })
    await until(() => watcher.seen.snap?.meta?.n === 2)
    expect(watcher.seen.snap!.meta).toMatchObject({ n: 2, cps: 8 })
    watcher.stop()
  })

  test('[G1-4] 開新一局被伺服器拒絕時，本機不會先出現那一局', async () => {
    const { host, guest } = await twoPlayers()
    await host.race.start(1, () => 6, { [host.uid]: 0, [guest.uid]: 1 })
    const rounds: (number | undefined)[] = []
    const stop = guest.race.watch(
      (snap) => rounds.push(snap.meta?.n),
      () => undefined,
    )
    await until(() => rounds.includes(1))

    await expect(guest.race.start(0, () => 6, { [guest.uid]: 0 })).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 300))
    expect(rounds.every((n) => n === 1)).toBe(true)
    stop()
  })

  test('[N1-2] 房主寫入的 AI 位置與玩家的進度，其他人都收得到；非房主不能寫 AI', async () => {
    const { host, guest } = await twoPlayers()
    await host.race.start(2, () => 6, { [host.uid]: 0, [guest.uid]: 1 })
    const watcher = observe(guest)
    await until(() => watcher.seen.snap?.meta?.n === 1)

    await host.race.sendAi({ '0': aiNet(1, 5), '1': aiNet(1, 6) })
    await until(() => watcher.seen.snap?.ai['1']?.x === 6)
    expect(watcher.seen.snap!.ai['0']).toEqual(aiNet(1, 5))
    await host.race.sendAi({ '0': aiNet(1, 9) })
    await until(() => watcher.seen.snap?.ai['0']?.x === 9)
    expect(watcher.seen.snap!.ai['1']).toEqual(aiNet(1, 6))
    await expect(guest.race.sendAi({ '0': aiNet(1, 1) })).rejects.toThrow()

    // 完成時間由伺服器蓋上，之後再送不會改寫
    const hostWatcher = observe(host)
    await host.race.sendAi({ '0': { ...aiNet(1, 9), fin: 1 } })
    await until(() => watcher.seen.snap?.ai['0']?.fin !== undefined)
    const fin = watcher.seen.snap!.ai['0']!.fin!
    expect(Math.abs(fin - Date.now())).toBeLessThan(60_000)
    await until(() => hostWatcher.seen.snap?.ai['0']?.fin === fin)
    await host.race.sendAi({ '0': { ...aiNet(1, 10), fin: 2 } })
    await until(() => watcher.seen.snap?.ai['0']?.x === 10)
    expect(watcher.seen.snap!.ai['0']!.fin).toBe(fin)

    // 規則要求整備 20 秒加倒數 3 秒結束後才能寫進度：把開賽時間往前推，不用真的等
    await expect(guest.race.sendProgress({ n: 1, cp: 1 })).rejects.toThrow()
    await backdate(host.code, PREP_MS + COUNTDOWN_MS + 100)
    await guest.race.sendProgress({ n: 1, cp: 1 })
    await until(() => hostWatcher.seen.snap?.progress[guest.uid]?.cp === 1)
    expect(hostWatcher.seen.snap!.progress[guest.uid]).toEqual({ n: 1, cp: 1 })
    watcher.stop()
    hostWatcher.stop()
  })

  test('[N3-1] 整備時送出的組裝，其他人都收得到；整備結束後就不能再改', async () => {
    const { host, guest } = await twoPlayers()
    await host.race.start(0, () => 6, { [host.uid]: 0, [guest.uid]: 1 })
    const watcher = observe(host)
    await until(() => watcher.seen.snap?.meta?.n === 1)

    const build = { n: 1, frame: 'carbon', wheel: 'slick', drive: 'single', bar: 'flat' } as const
    await guest.race.sendBuild(build)
    await until(() => watcher.seen.snap?.build[guest.uid] !== undefined)
    expect(watcher.seen.snap!.build[guest.uid]).toEqual(build)

    await backdate(host.code, PREP_MS + 100)
    await expect(guest.race.sendBuild({ ...build, frame: 'steel' })).rejects.toThrow()
    expect(watcher.seen.snap!.build[guest.uid]).toEqual(build)
    expect(watcher.seen.errors).toEqual([])
    watcher.stop()
  })
})

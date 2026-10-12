import { describe, expect, test } from 'vitest'
import { GameEngine, type Storage } from '../../game/engine'
import { checkpointPos, nodePose } from '../../sim/course'
import type { Progress, RaceMeta } from '../../sim/race'
import type { Vec2 } from '../../sim/types'
import { RaceController } from './controller'
import { EMPTY_RACE, localRaceLink, type RaceEntrant, type RaceLink, type RaceSnapshot } from './link'

const DT = 1 / 30
const IDLE = { forward: 0, right: 0, run: false, handbrake: false }
const PEDAL = { ...IDLE, forward: 1 }

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

function setup(link?: (now: () => number) => RaceLink) {
  let t = 1_000_000
  const now = () => t
  const engine = new GameEngine({ seed: 3, name: '阿明', storage: memoryStorage(), now })
  const raceLink = link?.(now) ?? localRaceLink('me', '阿明', now)
  let inRace = false
  const controller: RaceController = new RaceController({
    engine,
    link: raceLink,
    switchMode: (on) => {
      if (on === inRace) return
      inRace = on
      if (on) controller.enter()
      else controller.exit()
    },
  })
  controller.connect()
  const ride = async (seconds: number, input = IDLE) => {
    for (let k = 0; k < Math.round(seconds / DT); k++) {
      t += DT * 1000
      engine.update(DT, input)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  const player = () => engine.state.player
  const at = (p: Vec2) => {
    engine.teleport(p.x, p.z)
    return ride(DT)
  }
  return { engine, link: raceLink, controller, ride, player, at, inRace: () => inRace, now }
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

/** 兩位玩家的房間：other 的進度與是否在房內由測試控制 */
function twoPlayerLink(now: () => number) {
  let snap: RaceSnapshot = EMPTY_RACE
  let roster: RaceEntrant[] = [
    { id: 'me', name: '阿明' },
    { id: 'other', name: '小美' },
  ]
  const listeners = new Set<(s: RaceSnapshot) => void>()
  const publish = (next: RaceSnapshot) => {
    snap = next
    listeners.forEach((l) => l(snap))
  }
  const link: RaceLink = {
    selfId: 'me',
    serverNow: now,
    isHost: () => true,
    roster: () => roster,
    watch(onChange) {
      listeners.add(onChange)
      onChange(snap)
      return () => listeners.delete(onChange)
    },
    async start(ai, cps) {
      const meta: RaceMeta = { n: (snap.meta?.n ?? 0) + 1, ai, cps, at: now(), entrants: { me: 0, other: 1 } }
      publish({ meta, progress: {}, ai: {} })
    },
    async sendProgress(p) {
      publish({ ...snap, progress: { ...snap.progress, me: p } })
    },
    async sendAi(ai) {
      publish({ ...snap, ai })
    },
  }
  return {
    link,
    otherProgress: (p: Progress) => publish({ ...snap, progress: { ...snap.progress, other: p } }),
    otherLeaves: () => {
      roster = roster.filter((r) => r.id !== 'other')
      publish(snap)
    },
  }
}

/** 共用記憶體的房間：第一位是房主，房內玩家依序排起跑格 */
function memoryRoom(now: () => number, members: readonly RaceEntrant[]) {
  let snap: RaceSnapshot = EMPTY_RACE
  const listeners = new Set<(s: RaceSnapshot) => void>()
  const publish = (next: RaceSnapshot) => {
    snap = next
    listeners.forEach((l) => l(snap))
  }
  return (selfId: string): RaceLink => ({
    selfId,
    serverNow: now,
    isHost: () => selfId === members[0]!.id,
    roster: () => members,
    watch(onChange) {
      listeners.add(onChange)
      onChange(snap)
      return () => listeners.delete(onChange)
    },
    async start(ai, cps) {
      const entrants = Object.fromEntries(members.map((m, k) => [m.id, k]))
      publish({ meta: { n: (snap.meta?.n ?? 0) + 1, ai, cps, at: now(), entrants }, progress: {}, ai: {} })
    },
    async sendProgress(p) {
      publish({ ...snap, progress: { ...snap.progress, [selfId]: p } })
    },
    async sendAi(ai) {
      publish({ ...snap, ai })
    },
  })
}

/** 同一個房間裡的兩位玩家，各有自己的引擎與控制器，時間一起走 */
function twoRiders() {
  let t = 1_000_000
  const now = () => t
  const linkFor = memoryRoom(now, [
    { id: 'me', name: '阿明' },
    { id: 'other', name: '小美' },
  ])
  const engines = new Map<string, GameEngine>()
  const rider = (id: string, name: string) => {
    const engine = new GameEngine({ seed: 3, name, storage: memoryStorage(), now })
    engines.set(id, engine)
    let inRace = false
    const controller: RaceController = new RaceController({
      engine,
      link: linkFor(id),
      switchMode: (on) => {
        if (on === inRace) return
        inRace = on
        if (on) controller.enter()
        else controller.exit()
      },
      positionOf: (other) => engines.get(other)?.state.player.pos ?? null,
    })
    controller.connect()
    return { engine, controller, inRace: () => inRace, at: (p: Vec2) => engine.teleport(p.x, p.z) }
  }
  const me = rider('me', '阿明')
  const other = rider('other', '小美')
  const ride = async (seconds: number) => {
    for (let k = 0; k < Math.round(seconds / DT); k++) {
      t += DT * 1000
      me.engine.update(DT, IDLE)
      other.engine.update(DT, IDLE)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  return { me, other, ride }
}

describe('G1 開賽', () => {
  test('[G1-3] 開賽時在室內的玩家被移到起跑格騎上腳踏車，AI 在其餘起跑格', async () => {
    const { engine, controller, player, inRace } = setup()
    const home = engine.city.homes[0]!
    engine.teleport(home.door.x + Math.sin(home.facing), home.door.z + Math.cos(home.facing), home.facing + Math.PI)
    engine.action('interact')
    expect(player().location.kind).toBe('home')
    const car = player().car

    await controller.start(2)

    const course = controller.course()!
    expect(inRace()).toBe(true)
    expect(player().mode).toBe('bike')
    expect(player().location).toEqual({ kind: 'outdoor' })
    expect(player().pos).toEqual(course.grid[0]!.pos)
    expect(player().bike!.speed).toBe(0)
    expect(player().car).toEqual(car)
    expect(controller.aiRiders().map((a) => a.pos)).toEqual([course.grid[1]!.pos, course.grid[2]!.pos])
  })

  test('[G1-4] 開新的一局時進行中的那一局作廢，選手移到新一局的起跑格', async () => {
    const { controller, ride, player, at } = setup()
    await controller.start(1)
    const first = controller.course()!
    await ride(3.5, PEDAL)
    await at(checkpointPos(first, 0))
    expect(controller.view().cp).toBe(1)

    await controller.start(1)

    const second = controller.course()!
    expect(controller.view().n).toBe(2)
    expect(second.n).toBe(2)
    expect(controller.view().phase).toBe('countdown')
    expect(controller.view().cp).toBe(0)
    expect(player().pos).toEqual(second.grid[0]!.pos)
    expect(player().bike!.speed).toBe(0)
    expect(controller.aiRiders().map((a) => a.pos)).toEqual([second.grid[1]!.pos])
  })
})

test('[G1-4] 房主開新的一局時，兩位參賽者都回到新一局的起跑格重新倒數', async () => {
  const { me, other, ride } = twoRiders()
  await me.controller.start(0)
  await ride(3.5)
  const first = me.controller.course()!
  me.at(checkpointPos(first, 0))
  other.at(checkpointPos(first, 0))
  await ride(DT)
  expect(other.controller.view().cp).toBe(1)

  await me.controller.start(0)
  await ride(DT)

  const second = me.controller.course()!
  for (const [r, slot] of [[me, 0], [other, 1]] as const) {
    expect(r.controller.view().n).toBe(2)
    expect(r.controller.view().phase).toBe('countdown')
    expect(r.controller.view().cp).toBe(0)
    expect(r.engine.state.player.pos).toEqual(second.grid[slot]!.pos)
    expect(r.engine.state.player.bike!.speed).toBe(0)
  }
})

describe('G2 倒數與騎行', () => {
  test('[G2-1] 倒數 3 秒內按 W 不會移動，倒數結束後可以騎', async () => {
    const { controller, ride, player } = setup()
    await controller.start(0)
    const start = player().pos
    await ride(2.9, PEDAL)
    expect(controller.view().phase).toBe('countdown')
    expect(player().pos).toEqual(start)
    await ride(1, PEDAL)
    expect(controller.view().phase).toBe('racing')
    expect(distance(player().pos, start)).toBeGreaterThan(0.5)
  })

  test('[G2-2] HUD 資料：檢查點 x / N、經過時間、目前名次', async () => {
    const { controller, ride, at } = setup()
    await controller.start(1)
    const course = controller.course()!
    expect(controller.view().countdown).toBe(3)
    await ride(3 + 2)
    const v = controller.view()
    expect(v.cp).toBe(0)
    expect(v.cps).toBe(course.checkpoints.length)
    expect(v.elapsed).toBeGreaterThanOrEqual(1900)
    expect(v.elapsed).toBeLessThanOrEqual(2100)
    expect(v.total).toBe(2)
    await at(checkpointPos(course, 0))
    expect(controller.view().cp).toBe(1)
    expect(controller.view().rank).toBe(1)
  })

  test('[G2-4] 按 R 回到最後通過的檢查點（未通過時回起跑格），速度歸零、朝向下一段', async () => {
    const { engine, controller, ride, player, at } = setup()
    await controller.start(0)
    const course = controller.course()!
    await ride(3 + 1.5, PEDAL)
    expect(player().bike!.speed).toBeGreaterThan(0)
    engine.action('reset')
    expect(player().pos).toEqual(course.grid[0]!.pos)
    expect(player().heading).toBe(course.grid[0]!.heading)
    expect(player().bike!.speed).toBe(0)

    await at(checkpointPos(course, 0))
    await ride(1, PEDAL)
    engine.action('reset')
    const pose = nodePose(course, course.checkpoints[0]!)
    expect(player().pos).toEqual(pose.pos)
    expect(player().heading).toBe(pose.heading)
    expect(player().bike!.speed).toBe(0)
    expect(player().mode).toBe('bike')
  })
})

describe('G3 檢查點與名次', () => {
  test('[G3-1] 依序通過檢查點才加一，通過最後一個即完成並記錄時間，之後不能再騎', async () => {
    const { controller, link, ride, player, at, now } = setup()
    await controller.start(0)
    const course = controller.course()!
    const cps = course.checkpoints.length
    await ride(3.1)

    await at(checkpointPos(course, 1))
    expect(controller.view().cp).toBe(0)
    let finishedAt = 0
    for (let k = 0; k < cps; k++) {
      await at(checkpointPos(course, k))
      expect(controller.view().cp).toBe(k + 1)
      if (k === cps - 1) finishedAt = now()
    }
    expect(controller.view().finished).toBe(true)
    await ride(0.5)

    const uploads: Progress[] = []
    link.watch((s) => s.progress.me && uploads.push(s.progress.me))
    expect(uploads.at(-1)).toEqual({ n: 1, cp: cps, fin: finishedAt })

    const stop = player().pos
    await ride(1, PEDAL)
    expect(player().pos).toEqual(stop)
    expect(player().bike!.speed).toBe(0)
  })

  test('[G3-1] 進度依序上傳，每筆比上一筆多一個檢查點', async () => {
    const { controller, link, ride, at } = setup()
    const sent: number[] = []
    const send = link.sendProgress.bind(link)
    link.sendProgress = (p) => {
      sent.push(p.cp)
      return send(p)
    }
    await controller.start(0)
    const course = controller.course()!
    await ride(3.1)
    for (let k = 0; k < 3; k++) await at(checkpointPos(course, k))
    await ride(0.5)
    expect(sent).toEqual([1, 2, 3])
  })

  test('[G3-3] 中途離開房間的玩家不列入名次', async () => {
    let room!: ReturnType<typeof twoPlayerLink>
    const { controller, ride } = setup((now) => {
      room = twoPlayerLink(now)
      return room.link
    })
    await controller.start(0)
    await ride(3.5)
    room.otherProgress({ n: 1, cp: 3 })
    await ride(DT)
    expect(controller.view().total).toBe(2)
    expect(controller.view().rank).toBe(2)

    room.otherLeaves()
    await ride(DT)
    expect(controller.view().total).toBe(1)
    expect(controller.view().rank).toBe(1)
  })
})

test('[G3-2] 同樣檢查點數時，離下一個檢查點較近的玩家名次在前', async () => {
  const { me, other, ride } = twoRiders()
  await me.controller.start(0)
  await ride(3.5)
  const course = me.controller.course()!
  const next = checkpointPos(course, 0)
  me.at({ x: next.x + 30, z: next.z })
  other.at({ x: next.x + 15, z: next.z })
  await ride(DT)
  expect(me.controller.view().rank).toBe(2)
  expect(other.controller.view().rank).toBe(1)

  me.at({ x: next.x + 10, z: next.z })
  await ride(DT)
  expect(me.controller.view().rank).toBe(1)
  expect(other.controller.view().rank).toBe(2)
})

describe('G4 比賽結束', () => {
  test('[G4-4] 退出比賽的玩家回到自由逛街，成績表上該局記為未完成', async () => {
    const { me, other, ride } = twoRiders()
    await me.controller.start(0)
    await ride(3.5)
    const course = me.controller.course()!
    other.at(checkpointPos(course, 0))
    await ride(DT)

    other.controller.leave()
    expect(other.inRace()).toBe(false)
    expect(other.engine.state.player.mode).toBe('walk')

    for (let k = 0; k < course.checkpoints.length; k++) {
      me.at(checkpointPos(course, k))
      await ride(DT)
    }
    expect(me.controller.view().results).toBeNull()
    await ride(31)

    const results = me.controller.view().results!
    expect(results.map((r) => [r.name, r.time === null])).toEqual([
      ['阿明', false],
      ['小美', true],
    ])
  }, 60_000)
})

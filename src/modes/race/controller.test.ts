import { describe, expect, test } from 'vitest'
import { GameEngine, type Storage } from '../../game/engine'
import { checkpointPos, generateCourse, nodePose } from '../../sim/course'
import { goTime, type Progress, type RaceMeta } from '../../sim/race'
import { INTERP_DELAY } from '../../sim/sync'
import type { Vec2 } from '../../sim/types'
import { BIKE_SPEC } from '../../sim/vehicle'
import { RaceController } from './controller'
import { EMPTY_RACE, localRaceLink, type RaceEntrant, type RaceLink, type RaceSnapshot } from './link'

const DT = 1 / 30
const IDLE = { forward: 0, right: 0, run: false, handbrake: false }
const PEDAL = { ...IDLE, forward: 1 }

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

function setup(link?: (now: () => number) => RaceLink, onError?: (error: Error) => void) {
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
    onError,
  })
  const disconnect = controller.connect()
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
  return { engine, link: raceLink, controller, ride, player, at, inRace: () => inRace, now, disconnect }
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
    subscribeRoster: () => () => undefined,
    watch(onChange) {
      listeners.add(onChange)
      onChange(snap)
      return () => listeners.delete(onChange)
    },
    async start(ai, cpsOf) {
      const n = (snap.meta?.n ?? 0) + 1
      const meta: RaceMeta = { n, ai, cps: cpsOf(n), at: now(), entrants: { me: 0, other: 1 } }
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

/** 共用記憶體的房間：房內第一位是房主，房內玩家依序排起跑格；aiWriters 記錄寫過 AI 的玩家 */
function memoryRoom(now: () => number, initial: readonly RaceEntrant[]) {
  let members = initial
  let snap: RaceSnapshot = EMPTY_RACE
  const aiWriters = new Set<string>()
  const listeners = new Set<(s: RaceSnapshot) => void>()
  const publish = (next: RaceSnapshot) => {
    snap = next
    listeners.forEach((l) => l(snap))
  }
  const leave = (id: string) => {
    members = members.filter((m) => m.id !== id)
    publish(snap)
  }
  const join = (entrant: RaceEntrant) => {
    members = [...members, entrant]
    publish(snap)
  }
  const linkFor = (selfId: string): RaceLink => ({
    selfId,
    serverNow: now,
    isHost: () => selfId === members[0]?.id,
    roster: () => members,
    subscribeRoster: () => () => undefined,
    watch(onChange) {
      listeners.add(onChange)
      onChange(snap)
      return () => listeners.delete(onChange)
    },
    async start(ai, cpsOf) {
      const entrants = Object.fromEntries(members.map((m, k) => [m.id, k]))
      const n = (snap.meta?.n ?? 0) + 1
      publish({ meta: { n, ai, cps: cpsOf(n), at: now(), entrants }, progress: {}, ai: {} })
    },
    async sendProgress(p) {
      publish({ ...snap, progress: { ...snap.progress, [selfId]: p } })
    },
    async sendAi(ai) {
      aiWriters.add(selfId)
      publish({ ...snap, ai })
    },
  })
  return { linkFor, aiWriters, leave, join }
}

/** 同一個房間裡的兩位玩家，各有自己的引擎與控制器，時間一起走 */
function twoRiders() {
  let t = 1_000_000
  const now = () => t
  const room = memoryRoom(now, [
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
      link: room.linkFor(id),
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
  /** riders 是這段時間有在更新的玩家 */
  const ride = async (seconds: number, riders = [me, other]) => {
    for (let k = 0; k < Math.round(seconds / DT); k++) {
      t += DT * 1000
      riders.forEach((r) => r.engine.update(DT, IDLE))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  return { me, other, ride, room, now, rider }
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

  test('[N1-1] 伺服器確認後，自己的完成時間改用伺服器寫入的時間', async () => {
    const { controller, link, ride, at } = setup()
    const seen: { meta: RaceMeta | null; localFin: number } = { meta: null, localFin: 0 }
    link.watch((s) => {
      seen.meta = s.meta
    })
    const send = link.sendProgress.bind(link)
    link.sendProgress = (p) => {
      if (p.fin === undefined) return send(p)
      seen.localFin = p.fin
      return send({ ...p, fin: p.fin + 200 })
    }
    await controller.start(0)
    const course = controller.course()!
    await ride(3.1)
    for (let k = 0; k < course.checkpoints.length; k++) await at(checkpointPos(course, k))
    await ride(0.5)
    const time = seen.localFin + 200 - goTime(seen.meta!)
    expect(controller.view().results?.[0]?.time).toBe(time)
    expect(controller.view().elapsed).toBe(Math.floor(time / 100) * 100)
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

describe('N1 比賽同步', () => {
  test('[N1-1] 伺服器修正開賽時間後，經過時間跟著改', async () => {
    const shift = { ms: 0 }
    const { controller, link, ride } = setup((now) => {
      const base = localRaceLink('me', '阿明', now)
      return { ...base, watch: (onChange) => base.watch((s) => onChange(s.meta ? { ...s, meta: { ...s.meta, at: s.meta.at + shift.ms } } : s)) }
    })
    await controller.start(0)
    await ride(3.6)
    const before = controller.view().elapsed
    shift.ms = 500
    await link.sendAi({})
    expect(controller.view().elapsed).toBe(before - 500)
  })

  test('[N1-1] 房主畫面上 AI 的完成時間改用伺服器寫入的時間', async () => {
    const { controller, link, ride, at } = setup()
    const seen: { meta: RaceMeta | null; localFin: number | undefined } = { meta: null, localFin: undefined }
    link.watch((s) => {
      seen.meta = s.meta
    })
    const send = link.sendAi.bind(link)
    link.sendAi = (ai) => {
      const fin = ai['0']?.fin
      if (fin === undefined) return send(ai)
      seen.localFin ??= fin
      return send({ ...ai, '0': { ...ai['0']!, fin: seen.localFin + 200 } })
    }
    await controller.start(1)
    const course = controller.course()!
    for (let k = 0; k < 300 && seen.localFin === undefined; k++) await ride(1)
    for (let k = 0; k < course.checkpoints.length; k++) await at(checkpointPos(course, k))
    await ride(0.5)
    const row = controller.view().results?.find((r) => r.id === 'ai0')
    expect(row?.time).toBe(seen.localFin! + 200 - goTime(seen.meta!))
  }, 180_000)

  test('[N1-2] AI 只由房主計算並寫入，其他人畫面上的 AI 落後 100 ms 跟著房主寫入的位置移動', async () => {
    const { me, other, ride, room, now } = twoRiders()
    await me.controller.start(2)
    await ride(6)
    const history: { t: number; pos: Vec2 }[] = []
    for (let k = 0; k < 30; k++) {
      await ride(DT)
      history.push({ t: now(), pos: me.controller.aiRiders()[0]!.pos })
    }

    expect(room.aiWriters).toEqual(new Set(['me']))
    const shown = other.controller.aiRiders()
    expect(shown).toHaveLength(2)
    const past = history.filter((h) => h.t <= now() - INTERP_DELAY).at(-1)!.pos
    const latest = history.at(-1)!.pos
    expect(distance(shown[0]!.pos, past)).toBeLessThan(0.4)
    expect(distance(shown[0]!.pos, latest)).toBeGreaterThan(0.6)
  })

  test('[N1-3] 房主離開後，新房主從最後同步的位置接手計算 AI', async () => {
    const { me, other, ride, room } = twoRiders()
    await me.controller.start(2)
    await ride(8)
    const course = me.controller.course()!
    const handover = me.controller.aiRiders().map((a) => a.pos)
    expect(distance(handover[0]!, course.grid[2]!.pos)).toBeGreaterThan(10)

    room.leave('me')
    await ride(DT, [other])
    const resumed = other.controller.aiRiders().map((a) => a.pos)
    resumed.forEach((pos, k) => expect(distance(pos, handover[k]!)).toBeLessThan(1.5))

    await ride(2, [other])
    expect(room.aiWriters).toEqual(new Set(['me', 'other']))
    other.controller.aiRiders().forEach((a, k) => expect(distance(a.pos, resumed[k]!)).toBeGreaterThan(5))
  })

  test('[N1-2] 倒數期間其他人畫面上的 AI 就在起跑格上', async () => {
    const { me, other, ride } = twoRiders()
    await me.controller.start(2)
    await ride(1)
    expect(other.controller.view().phase).toBe('countdown')
    const course = other.controller.course()!
    const shown = other.controller.aiRiders()
    expect(shown).toHaveLength(2)
    shown.forEach((a, k) => expect(distance(a.pos, course.grid[k + 2]!.pos)).toBeLessThan(0.01))
  })

  test('[N1-3] 開賽後才加入的玩家成為房主時接手推進 AI，但不參賽', async () => {
    const { me, other, ride, room, rider } = twoRiders()
    await me.controller.start(2)
    await ride(5)
    room.join({ id: 'late', name: '阿花' })
    const late = rider('late', '阿花')
    await ride(DT, [me, other, late])
    expect(late.inRace()).toBe(false)
    expect(late.controller.slot()).toBeNull()

    room.leave('me')
    room.leave('other')
    await ride(DT, [late])
    const resumed = late.controller.aiRiders().map((a) => a.pos)
    await ride(2, [late])
    expect(room.aiWriters).toEqual(new Set(['me', 'late']))
    late.controller.aiRiders().forEach((a, k) => expect(distance(a.pos, resumed[k]!)).toBeGreaterThan(5))
    expect(late.inRace()).toBe(false)
  })

  test('[N1-3] 開局時已是房主的晚到玩家從最後同步的位置接手 AI，不會回到起跑格', async () => {
    const { me, ride, room, rider } = twoRiders()
    await me.controller.start(2)
    await ride(8)
    const course = me.controller.course()!
    const handover = me.controller.aiRiders().map((a) => a.pos)
    expect(distance(handover[0]!, course.grid[2]!.pos)).toBeGreaterThan(10)

    room.leave('me')
    room.leave('other')
    room.join({ id: 'late', name: '阿花' })
    const late = rider('late', '阿花')
    await ride(DT, [late])
    const resumed = late.controller.aiRiders().map((a) => a.pos)
    resumed.forEach((pos, k) => expect(distance(pos, handover[k]!)).toBeLessThan(1.5))
  })

  test('[N1-3] 房主退出比賽回到城市後仍繼續推進並寫入 AI', async () => {
    const { me, other, ride } = twoRiders()
    await me.controller.start(2)
    await ride(5)
    me.controller.leave()
    expect(me.inRace()).toBe(false)
    const before = other.controller.aiRiders().map((a) => a.pos)
    await ride(2)
    other.controller.aiRiders().forEach((a, k) => expect(distance(a.pos, before[k]!)).toBeGreaterThan(5))
  })

  test('[N1-3] 已退出比賽的玩家成為房主時也會接手推進 AI', async () => {
    const { me, other, ride, room } = twoRiders()
    await me.controller.start(2)
    await ride(5)
    other.controller.leave()
    room.leave('me')
    await ride(DT, [other])
    const resumed = other.controller.aiRiders().map((a) => a.pos)
    await ride(2, [other])
    expect(room.aiWriters).toEqual(new Set(['me', 'other']))
    other.controller.aiRiders().forEach((a, k) => expect(distance(a.pos, resumed[k]!)).toBeGreaterThan(5))
  })

  test('[N1-1] 最後一台 AI 完成後比賽立刻結束，完成時間仍會寫入，寫入失敗時重送', async () => {
    const errors: Error[] = []
    const { controller, link, ride, at } = setup(undefined, (e) => errors.push(e))
    let stored: RaceSnapshot = EMPTY_RACE
    link.watch((s) => {
      stored = s
    })
    const send = link.sendAi.bind(link)
    let rejected = false
    link.sendAi = (ai) => {
      if (ai['0']?.fin === undefined || rejected) return send(ai)
      rejected = true
      return Promise.reject(new Error('寫入失敗'))
    }
    await controller.start(1)
    const course = controller.course()!
    const cps = course.checkpoints.length
    for (let k = 0; k < 300 && controller.aiRiders()[0]!.cp < cps - 1; k++) await ride(1)
    for (let k = 0; k < cps; k++) await at(checkpointPos(course, k))
    expect(controller.view().finished).toBe(true)
    for (let k = 0; k < 600 && !controller.aiRiders()[0]!.fin; k++) await ride(0.1)
    await ride(0.5)

    expect(controller.view().phase).toBe('over')
    expect(rejected).toBe(true)
    expect(errors.map((e) => e.message)).toEqual(['寫入失敗'])
    expect(stored.ai['0']?.fin).toBeDefined()
  }, 180_000)
})

describe('G1 開新的一局被拒絕', () => {
  test('[G1-4] 開新一局被伺服器拒絕時顯示錯誤，進行中的那一局照常繼續', async () => {
    const errors: Error[] = []
    let snap: RaceSnapshot = EMPTY_RACE
    let reject = false
    const { controller, inRace, ride } = setup((now) => {
      const base = localRaceLink('me', '阿明', now)
      base.watch((s) => {
        snap = s
      })
      return {
        ...base,
        start: (ai, cps) => (reject ? Promise.reject(new Error('權限不足')) : base.start(ai, cps)),
      }
    }, (e) => errors.push(e))

    await controller.start(2)
    await ride(4)
    reject = true
    await controller.start(0)
    expect(errors.map((e) => e.message)).toEqual(['權限不足'])
    expect(snap.meta?.n).toBe(1)
    expect(inRace()).toBe(true)
    expect(controller.view().n).toBe(1)
    const before = controller.aiRiders().map((a) => a.pos)
    await ride(2)
    controller.aiRiders().forEach((a, k) => expect(distance(a.pos, before[k]!)).toBeGreaterThan(5))
  })

  // 伺服器確認前送出比賽資料的寫入會讓開新一局的 transaction 中止
  test('[G1-4] 開新一局等待伺服器確認期間不寫入進度與 AI', async () => {
    let hold = false
    let gate: (() => void) | null = null
    const writes: string[] = []
    const { controller, ride, at } = setup((now) => {
      const base = localRaceLink('me', '阿明', now)
      return {
        ...base,
        start: (ai, cpsOf) => {
          if (!hold) return base.start(ai, cpsOf)
          return new Promise<void>((resolve, reject) => {
            gate = () => base.start(ai, cpsOf).then(resolve, reject)
          })
        },
        sendProgress: (p) => {
          if (gate) writes.push('progress')
          return base.sendProgress(p)
        },
        sendAi: (ai) => {
          if (gate) writes.push('ai')
          return base.sendAi(ai)
        },
      }
    })

    await controller.start(2)
    await ride(4)
    hold = true
    const started = controller.start(2)
    await at(checkpointPos(controller.course()!, 0))
    await ride(1)
    expect(writes).toEqual([])
    expect(controller.view().n).toBe(1)

    gate!()
    gate = null
    await started
    expect(controller.view().n).toBe(2)
  })

  // 開局的 transaction 重試時局數可能和本機看到的不同
  test('[G1-4] 開新一局的檢查點數依伺服器實際開出的局數計算', async () => {
    let cpsOf: ((n: number) => number) | null = null
    const { engine, controller } = setup((now) => {
      const base = localRaceLink('me', '阿明', now)
      return {
        ...base,
        start: (ai, f) => {
          cpsOf = f
          return base.start(ai, f)
        },
      }
    })

    await controller.start(0)
    const rounds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(rounds.map((n) => cpsOf!(n))).toEqual(rounds.map((n) => generateCourse(engine.city, n).checkpoints.length))
  })

  test('[G1-4] 等待伺服器確認期間再按開始不會再開一局', async () => {
    let gate: (() => void) | null = null
    let starts = 0
    const { controller } = setup((now) => {
      const base = localRaceLink('me', '阿明', now)
      return {
        ...base,
        start: (ai, cpsOf) => {
          starts += 1
          return new Promise<void>((resolve, reject) => {
            gate = () => base.start(ai, cpsOf).then(resolve, reject)
          })
        },
      }
    })

    const first = controller.start(2)
    const second = controller.start(2)
    expect(starts).toBe(1)
    gate!()
    await Promise.all([first, second])
    expect(starts).toBe(1)
    expect(controller.view().n).toBe(1)
  })
})

test('[B1-5] 連線比賽時自己的腳踏車撞到其他參賽玩家會被推開，已完賽的玩家不擋路', async () => {
  const { me, other, ride } = twoRiders()
  await me.controller.start(0)
  await ride(3.5)
  const pos = me.engine.state.player.pos
  other.at({ x: pos.x + 0.2, z: pos.z })
  await ride(DT, [me])
  expect(distance(me.engine.state.player.pos, other.engine.state.player.pos)).toBeGreaterThan(BIKE_SPEC.radius * 2 - 0.01)

  const course = other.controller.course()!
  for (let k = 0; k < course.checkpoints.length; k++) {
    other.at(checkpointPos(course, k))
    await ride(DT)
  }
  expect(other.controller.view().finished).toBe(true)
  const mine = me.engine.state.player.pos
  other.at({ x: mine.x + 0.2, z: mine.z })
  await ride(DT, [me])
  expect(me.engine.state.player.pos).toEqual(mine)
})

test('[A1-5] 房主算的 AI 撞到其他參賽玩家時被推開', async () => {
  const { me, other, ride } = twoRiders()
  await me.controller.start(1)
  await ride(3.5)
  const ai = me.controller.aiRiders()[0]!.pos
  other.at({ x: ai.x + 0.2, z: ai.z })
  await ride(DT, [me])
  expect(distance(me.controller.aiRiders()[0]!.pos, other.engine.state.player.pos)).toBeGreaterThan(BIKE_SPEC.radius * 2 - 0.01)
})

test('[N1-3] 停止監聽後，回到城市的房主不再於背景推進或上傳 AI', async () => {
  let writes = 0
  const { controller, ride, disconnect } = setup((now) => {
    const base = localRaceLink('me', '阿明', now)
    return {
      ...base,
      sendAi: (ai) => {
        writes += 1
        return base.sendAi(ai)
      },
    }
  })
  await controller.start(2)
  await ride(4)
  controller.leave()
  await ride(1)
  expect(writes).toBeGreaterThan(0)

  disconnect()
  writes = 0
  await ride(2)
  expect(writes).toBe(0)
})

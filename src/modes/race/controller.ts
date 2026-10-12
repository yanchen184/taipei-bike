import type { Action, EngineHooks, GameEngine, GameState } from '../../game/engine'
import { AI_STEP, createAi, riderCircles, stepAi, type AiRider } from '../../sim/ai'
import { advanceCheckpoint, distanceToNext, generateCourse, respawnPose, type Course } from '../../sim/course'
import {
  MAX_RACERS,
  aiId,
  aiLimit,
  aiName,
  firstFinish,
  goTime,
  racePhase,
  rankRacers,
  type AiNet,
  type RaceMeta,
  type RacePhase,
  type Standing,
} from '../../sim/race'
import type { Vec2 } from '../../sim/types'
import { EMPTY_RACE, type RaceLink, type RaceSnapshot } from './link'

/** 房主上傳 AI 的最短間隔（毫秒） */
const AI_SEND_MS = 100
/** HUD 經過時間的精度（毫秒） */
const CLOCK_STEP = 100
/** 比賽中引擎不處理的按鍵：R 改成回檢查點，E、Q 不能下車或叫車 */
const BLOCKED_ACTIONS: readonly Action[] = ['interact', 'callCar']

export interface ResultRow {
  rank: number
  id: string
  name: string
  /** 從倒數結束到完成的毫秒數；未完成為 null */
  time: number | null
}

export interface RaceView {
  n: number
  /** 本局 AI 台數 */
  ais: number
  phase: RacePhase
  /** 倒數剩下的秒數（無條件進位）；倒數結束後為 0 */
  countdown: number
  cp: number
  cps: number
  /** 倒數結束後經過的毫秒數，完成後停在完成時間 */
  elapsed: number
  rank: number
  total: number
  finished: boolean
  host: boolean
  /** 比賽結束後的成績表 */
  results: readonly ResultRow[] | null
}

export interface AiPose {
  pos: Vec2
  heading: number
  cp: number
  fin: boolean
}

export interface RaceControllerOptions {
  engine: GameEngine
  link: RaceLink
  /** true 切到競速模式，false 切回自由逛街 */
  switchMode(race: boolean): void
  /** 其他玩家目前的位置，用來算離下一檢查點的距離；不知道時回傳 null */
  positionOf?(id: string): Vec2 | null
  onError?(error: Error): void
}

interface Round {
  meta: RaceMeta
  course: Course
  slot: number
  cp: number
  fin?: number
  /** 伺服器已確認的檢查點數 */
  sentCp: number
  /** 完成或比賽結束後腳踏車已停下 */
  stopped: boolean
  /** 房主推進中的 AI；非房主為空，改讀 snapshot */
  ais: AiRider[]
  aiFin: (number | undefined)[]
  aiClock: number
  aiSentAt: number
}

const IDLE_VIEW: RaceView = {
  n: 0,
  ais: 0,
  phase: 'countdown',
  countdown: 0,
  cp: 0,
  cps: 0,
  elapsed: 0,
  rank: 0,
  total: 0,
  finished: false,
  host: false,
  results: null,
}

function viewEqual(a: RaceView, b: RaceView): boolean {
  return (Object.keys(a) as (keyof RaceView)[]).every((k) =>
    k === 'results' ? JSON.stringify(a.results) === JSON.stringify(b.results) : a[k] === b[k],
  )
}

/** 起跑格中沒有分給玩家的格子，依序給 AI */
function aiSlots(meta: RaceMeta): number[] {
  const used = new Set(Object.values(meta.entrants))
  return Array.from({ length: MAX_RACERS }, (_, k) => k)
    .filter((k) => !used.has(k))
    .slice(0, meta.ai)
}

/** 一個 session 一個：管理目前這一局、房主推進 AI、切換競速模式 */
export class RaceController {
  private readonly engine: GameEngine
  private readonly link: RaceLink
  private readonly options: RaceControllerOptions
  private snap: RaceSnapshot = EMPTY_RACE
  private round: Round | null = null
  private active = false
  private sending = false
  private current: RaceView = IDLE_VIEW
  private readonly listeners = new Set<() => void>()

  readonly hooks: EngineHooks = {
    obstacles: () => riderCircles(this.aiRiders()),
    controls: () => this.canRide(),
    action: (action) => this.handleAction(action),
    afterStep: (state, dt) => this.afterStep(state, dt),
  }

  constructor(options: RaceControllerOptions) {
    this.options = options
    this.engine = options.engine
    this.link = options.link
  }

  /** 開始監聽比賽資料，回傳停止函式 */
  connect(): () => void {
    return this.link.watch((snap) => this.onSnapshot(snap))
  }

  view = (): RaceView => this.current

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  isHost(): boolean {
    return this.link.isHost()
  }

  aiLimit(): number {
    return aiLimit(this.link.roster().length)
  }

  course(): Course | null {
    return this.round?.course ?? null
  }

  slot(): number | null {
    return this.round?.slot ?? null
  }

  /** 房主開新的一局 */
  async start(ai: number): Promise<void> {
    const n = (this.snap.meta?.n ?? 0) + 1
    const course = generateCourse(this.engine.city, n)
    try {
      await this.link.start(Math.min(ai, this.aiLimit()), course.checkpoints.length)
    } catch (error: unknown) {
      this.report(error)
    }
  }

  /** 房主用同樣的 AI 數量再開一局 */
  again(): Promise<void> {
    return this.start(this.snap.meta?.ai ?? 0)
  }

  /** 回到城市或退出比賽；退出的這一局記為未完成 */
  leave(): void {
    this.options.switchMode(false)
  }

  /** 競速模式的 onEnter：掛上引擎掛點，在起跑格或重生點騎上腳踏車 */
  enter(): void {
    this.active = true
    this.engine.setHooks(this.hooks)
    const r = this.round
    if (r) this.engine.mountBike(respawnPose(r.course, r.cp, r.slot))
  }

  /** 競速模式的 onExit：清掉掛點，下車站在腳踏車旁 */
  exit(): void {
    this.active = false
    this.engine.setHooks(null)
    this.engine.dismountBike()
  }

  /** 目前畫面上的 AI：房主用自己算的，其他人用最後收到的同步資料 */
  aiRiders(): AiPose[] {
    const r = this.round
    if (!r) return []
    if (this.link.isHost()) {
      return r.ais.map((a) => ({ pos: a.bike.pos, heading: a.bike.heading, cp: a.cp, fin: a.fin }))
    }
    return Array.from({ length: r.meta.ai }, (_, k) => this.snap.ai[String(k)])
      .filter((a): a is AiNet => a?.n === r.meta.n)
      .map((a) => ({ pos: { x: a.x, z: a.z }, heading: a.h, cp: a.cp, fin: a.fin !== undefined }))
  }

  private onSnapshot(snap: RaceSnapshot): void {
    this.snap = snap
    const meta = snap.meta
    if (meta && meta.n !== this.round?.meta.n && this.link.selfId in meta.entrants) this.beginRound(meta)
    this.refresh()
  }

  private beginRound(meta: RaceMeta): void {
    const course = generateCourse(this.engine.city, meta.n)
    const slot = meta.entrants[this.link.selfId]!
    const slots = aiSlots(meta)
    this.round = {
      meta,
      course,
      slot,
      cp: 0,
      sentCp: 0,
      stopped: false,
      ais: slots.map((s) => createAi(course, s)),
      aiFin: slots.map(() => undefined),
      aiClock: 0,
      aiSentAt: -Infinity,
    }
    if (this.active) this.engine.mountBike(course.grid[slot]!)
    else this.options.switchMode(true)
  }

  private phase(now = this.link.serverNow()): RacePhase {
    const r = this.round
    if (!r) return 'countdown'
    return racePhase(r.meta, this.standings(), this.firstFin(), now)
  }

  private canRide(): boolean {
    return this.round?.fin === undefined && this.phase() === 'racing'
  }

  private handleAction(action: Action): boolean {
    const r = this.round
    if (action === 'reset') {
      if (r && this.canRide()) this.engine.mountBike(respawnPose(r.course, r.cp, r.slot))
      return true
    }
    return BLOCKED_ACTIONS.includes(action)
  }

  private afterStep(state: GameState, dt: number): void {
    const r = this.round
    if (!r) return
    const now = this.link.serverNow()
    const phase = this.phase(now)
    const p = state.player
    if (phase === 'racing' && r.fin === undefined && p.mode === 'bike') {
      const cp = advanceCheckpoint(r.course, r.cp, p.pos)
      if (cp !== r.cp) this.round = { ...r, cp, fin: cp === r.course.checkpoints.length ? now : undefined }
    }
    const done = this.round!.fin !== undefined || phase === 'over'
    if (done && !this.round!.stopped) {
      this.round = { ...this.round!, stopped: true }
      this.engine.mountBike({ pos: p.pos, heading: p.heading })
    }
    this.sendProgress()
    if (phase === 'racing' && this.link.isHost()) this.stepAis(state, dt, now)
    this.refresh(now)
  }

  /** 依序上傳：一次只送一筆，每筆比伺服器已確認的多一個檢查點 */
  private sendProgress(): void {
    const r = this.round
    if (!r || this.sending || r.sentCp >= r.cp) return
    const cp = r.sentCp + 1
    const last = cp === r.course.checkpoints.length
    this.sending = true
    this.link
      .sendProgress(last && r.fin !== undefined ? { n: r.meta.n, cp, fin: r.fin } : { n: r.meta.n, cp })
      .then(() => {
        if (this.round?.meta.n === r.meta.n) this.round = { ...this.round, sentCp: cp }
      })
      .catch((error: unknown) => this.report(error))
      .finally(() => {
        this.sending = false
      })
  }

  private stepAis(state: GameState, dt: number, now: number): void {
    const r = this.round!
    const self = { pos: state.player.pos, fin: r.fin !== undefined }
    const traffic = this.engine.trafficObstacles()
    let ais = r.ais
    const aiFin = [...r.aiFin]
    let clock = r.aiClock + dt
    while (clock >= AI_STEP) {
      clock -= AI_STEP
      ais = ais.map((ai, k) => {
        const others = ais.filter((_, j) => j !== k).map((o) => ({ pos: o.bike.pos, fin: o.fin }))
        const next = stepAi(ai, k, r.course, AI_STEP, this.engine.city.colliders, [...riderCircles([self, ...others]), ...traffic])
        if (next.fin && aiFin[k] === undefined) aiFin[k] = now
        return next
      })
    }
    const send = now - r.aiSentAt >= AI_SEND_MS
    this.round = { ...r, ais, aiFin, aiClock: clock, aiSentAt: send ? now : r.aiSentAt }
    if (!send) return
    const net: Record<string, AiNet> = {}
    ais.forEach((a, k) => {
      const fin = aiFin[k]
      net[String(k)] = {
        n: r.meta.n,
        x: a.bike.pos.x,
        z: a.bike.pos.z,
        h: a.bike.heading,
        s: a.bike.speed,
        w: a.wp,
        cp: a.cp,
        ...(fin === undefined ? {} : { fin }),
      }
    })
    this.link.sendAi(net).catch((error: unknown) => this.report(error))
  }

  /** 仍在房內的參賽玩家與 AI */
  private standings(): Standing[] {
    const r = this.round
    if (!r) return []
    const present = new Set(this.link.roster().map((e) => e.id))
    const humans = Object.keys(r.meta.entrants)
      .filter((id) => present.has(id))
      .map((id): Standing => {
        if (id === this.link.selfId) {
          return { id, cp: r.cp, fin: r.fin, dist: distanceToNext(r.course, r.cp, this.engine.state.player.pos) }
        }
        const p = this.snap.progress[id]
        const theirs = p?.n === r.meta.n ? p : undefined
        const cp = theirs?.cp ?? 0
        const pos = this.options.positionOf?.(id) ?? null
        return { id, cp, fin: theirs?.fin, dist: pos ? distanceToNext(r.course, cp, pos) : Infinity }
      })
    const ais = this.aiRiders().map((a, k): Standing => ({
      id: aiId(k),
      cp: a.cp,
      fin: this.aiFinOf(k),
      dist: distanceToNext(r.course, a.cp, a.pos),
    }))
    return [...humans, ...ais]
  }

  private aiFinOf(k: number): number | undefined {
    const r = this.round!
    if (this.link.isHost()) return r.aiFin[k]
    const a = this.snap.ai[String(k)]
    return a?.n === r.meta.n ? a.fin : undefined
  }

  /** 本局最早的完成時間，含已離開房間的玩家 */
  private firstFin(): number | undefined {
    const r = this.round
    if (!r) return undefined
    const others = Object.entries(this.snap.progress)
      .filter(([id, p]) => id !== this.link.selfId && p.n === r.meta.n)
      .map(([, p]) => p)
    const ais = Array.from({ length: r.meta.ai }, (_, k) => ({ fin: this.aiFinOf(k) }))
    return firstFinish([{ fin: r.fin }, ...others, ...ais])
  }

  private nameOf(id: string): string {
    const k = Array.from({ length: MAX_RACERS }, (_, j) => j).find((j) => aiId(j) === id)
    if (k !== undefined) return aiName(k)
    return this.link.roster().find((e) => e.id === id)?.name ?? ''
  }

  private refresh(now = this.link.serverNow()): void {
    const r = this.round
    const next = r ? this.buildView(r, now) : IDLE_VIEW
    if (viewEqual(next, this.current)) return
    this.current = next
    this.listeners.forEach((l) => l())
  }

  private buildView(r: Round, now: number): RaceView {
    const go = goTime(r.meta)
    const ranked = rankRacers(this.standings())
    const phase = racePhase(r.meta, ranked, this.firstFin(), now)
    const elapsed = Math.max(0, (r.fin ?? now) - go)
    return {
      n: r.meta.n,
      ais: r.meta.ai,
      phase,
      countdown: phase === 'countdown' ? Math.ceil((go - now) / 1000) : 0,
      cp: r.cp,
      cps: r.course.checkpoints.length,
      elapsed: Math.floor(elapsed / CLOCK_STEP) * CLOCK_STEP,
      rank: ranked.findIndex((s) => s.id === this.link.selfId) + 1,
      total: ranked.length,
      finished: r.fin !== undefined,
      host: this.link.isHost(),
      results:
        phase === 'over'
          ? ranked.map((s, k) => ({ rank: k + 1, id: s.id, name: this.nameOf(s.id), time: s.fin === undefined ? null : s.fin - go }))
          : null,
    }
  }

  private report(error: unknown): void {
    const e = error instanceof Error ? error : new Error(String(error))
    if (this.options.onError) this.options.onError(e)
    else throw e
  }
}

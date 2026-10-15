import type { Action, EngineHooks, GameEngine, GameState } from '../../game/engine'
import { AI_STEP, aiDriver, createAi, riderCircles, stepAi, type AiDriver, type AiRider } from '../../sim/ai'
import { aiBuild } from '../../sim/balance'
import { advanceCheckpoint, distanceToNext, generateCourse, nextTurn, respawnPose, type Course, type TurnKind } from '../../sim/course'
import { DEFAULT_BUILD, bikeSpec, buildLabel, swapPart, type Build, type PartSlot } from '../../sim/parts'
import {
  MAX_RACERS,
  aiId,
  aiLimit,
  aiName,
  firstFinish,
  goTime,
  prepEnd,
  racePhase,
  rankRacers,
  type AiNet,
  type Progress,
  type RaceMeta,
  type RacePhase,
  type Standing,
} from '../../sim/race'
import { INTERP_DELAY, INTERP_KEEP, lerpAngle } from '../../sim/sync'
import type { Pose, Vec2 } from '../../sim/types'
import { EMPTY_RACE, type RaceLink, type RaceSnapshot } from './link'

/** 房主上傳 AI 的最短間隔（毫秒） */
const AI_SEND_MS = 100
/** HUD 經過時間的精度（毫秒） */
const CLOCK_STEP = 100
/** 路口提示距離的精度（公尺） */
const TURN_STEP = 10
/** 比賽中引擎不處理的按鍵：R 改成回檢查點，E、Q 不能下車或叫車 */
const BLOCKED_ACTIONS: readonly Action[] = ['interact', 'callCar']

export interface ResultRow {
  rank: number
  id: string
  name: string
  /** 四個零件名稱；不知道時為 null */
  build: string | null
  /** 從倒數結束到完成的毫秒數；未完成為 null */
  time: number | null
}

export interface RaceView {
  n: number
  /** 本局 AI 台數 */
  ais: number
  phase: RacePhase
  /** 連線整備剩下的秒數（無條件進位）；單人整備沒有時間限制、或不在整備時為 null */
  prepLeft: number | null
  /** 自己這一局的組裝 */
  build: Build
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
  /** 下一個路口怎麼轉；不在競速模式、不參賽或已完成時為 null */
  turn: TurnKind | null
  /** 到下一個路口的距離，以 TURN_STEP 為單位 */
  turnDist: number
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
  /** 自己的起跑格；開賽後才加入、不參賽時為 null */
  slot: number | null
  cp: number
  fin?: number
  /** 伺服器已確認的檢查點數 */
  sentCp: number
  /** 完成或比賽結束後腳踏車已停下 */
  stopped: boolean
  /** 自己在整備站選的組裝 */
  build: Build
  /** 組裝有伺服器還沒確認的變動 */
  buildDirty: boolean
  /** 目前騎的腳踏車用的組裝 */
  ridden: Build | null
  /** 每台 AI 本局的組裝與騎法，由 seed＋局數決定，所有人算出來一樣 */
  aiBuilds: Build[]
  drivers: AiDriver[]
  /** 自己當房主時推進的 AI；aiLive 為 false 時內容過期，改用同步資料 */
  ais: AiRider[]
  aiFin: (number | undefined)[]
  aiLive: boolean
  aiClock: number
  aiSentAt: number
  /** AI 有伺服器還沒確認的變動 */
  aiDirty: boolean
}

const IDLE_VIEW: RaceView = {
  n: 0,
  ais: 0,
  phase: 'countdown',
  prepLeft: null,
  build: DEFAULT_BUILD,
  countdown: 0,
  cp: 0,
  cps: 0,
  elapsed: 0,
  rank: 0,
  total: 0,
  finished: false,
  host: false,
  results: null,
  turn: null,
  turnDist: 0,
}

function viewEqual(a: RaceView, b: RaceView): boolean {
  return (Object.keys(a) as (keyof RaceView)[]).every((k) =>
    k === 'results' ? JSON.stringify(a.results) === JSON.stringify(b.results) : a[k] === b[k],
  )
}

function sameBuild(a: Build, b: Build): boolean {
  return a.frame === b.frame && a.wheel === b.wheel && a.drive === b.drive && a.bar === b.bar
}

/** 起跑格中沒有分給玩家的格子，依序給 AI */
function aiSlots(meta: RaceMeta): number[] {
  const used = new Set(Object.values(meta.entrants))
  return Array.from({ length: MAX_RACERS }, (_, k) => k)
    .filter((k) => !used.has(k))
    .slice(0, meta.ai)
}

/** 收到一筆 AI 同步資料的時間（serverNow） */
interface AiSample extends AiNet {
  at: number
}

/** samples 依 at 遞增，取 t 這個時間點的內插位置 */
function interpolateAi(samples: readonly AiSample[], t: number): AiPose {
  const pose = (a: AiSample, pos: Vec2, heading: number): AiPose => ({ pos, heading, cp: a.cp, fin: a.fin !== undefined })
  const first = samples[0]!
  const last = samples.at(-1)!
  if (t <= first.at) return pose(first, { x: first.x, z: first.z }, first.h)
  if (t >= last.at) return pose(last, { x: last.x, z: last.z }, last.h)
  const k = samples.findIndex((s) => s.at >= t)
  const a = samples[k - 1]!
  const b = samples[k]!
  const u = (t - a.at) / (b.at - a.at)
  return pose(b, { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u }, lerpAngle(a.h, b.h, u))
}

/** 一個 session 一個：管理目前這一局、房主推進 AI、切換競速模式 */
export class RaceController {
  private readonly engine: GameEngine
  private readonly link: RaceLink
  private readonly options: RaceControllerOptions
  private snap: RaceSnapshot = EMPTY_RACE
  private round: Round | null = null
  /** 本局每台 AI 最近收到的同步資料，非房主畫面內插用 */
  private aiSamples = new Map<string, readonly AiSample[]>()
  private active = false
  private sending = false
  private sendingAi = false
  private sendingBuild = false
  /** 開新一局等待伺服器確認中；這段期間寫入比賽資料會讓開局的 transaction 中止 */
  private starting = false
  private current: RaceView = IDLE_VIEW
  private readonly listeners = new Set<() => void>()

  readonly hooks: EngineHooks = {
    obstacles: () => riderCircles([...this.aiRiders(), ...this.otherRacers()]),
    controls: () => this.canRide(),
    action: (action) => this.handleAction(action),
    afterStep: (state, dt) => this.afterStep(state, dt),
  }

  /** 不在競速模式時仍要推進：房主繼續算 AI、上傳進度、接手 AI；不參賽的人成為房主時也靠它推進 AI */
  private readonly background: EngineHooks = {
    afterStep: (state, dt) => this.afterStep(state, dt),
  }

  constructor(options: RaceControllerOptions) {
    this.options = options
    this.engine = options.engine
    this.link = options.link
  }

  /** 開始監聽比賽資料，回傳停止函式；停止時不在競速模式就一併拿掉背景掛點 */
  connect(): () => void {
    if (!this.active) this.engine.setHooks(this.background)
    const stop = this.link.watch((snap) => this.onSnapshot(snap))
    return () => {
      stop()
      if (!this.active) this.engine.setHooks(null)
    }
  }

  view = (): RaceView => this.current

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** isHost、aiLimit 可能變動時呼叫 listener */
  subscribeRoster = (listener: () => void): (() => void) => this.link.subscribeRoster(listener)

  isHost = (): boolean => this.link.isHost()

  aiLimit = (): number => aiLimit(this.link.roster().length)

  course(): Course | null {
    return this.round?.course ?? null
  }

  slot(): number | null {
    return this.round?.slot ?? null
  }

  /** 房主開新的一局；上一次開局還在等伺服器確認時不做事 */
  async start(ai: number): Promise<void> {
    if (this.starting) return
    this.starting = true
    try {
      await this.link.start(Math.min(ai, this.aiLimit()), (n) => generateCourse(this.engine.city, n).checkpoints.length)
    } catch (error: unknown) {
      this.report(error)
    } finally {
      this.starting = false
    }
  }

  /** 房主用同樣的 AI 數量再開一局 */
  again(): Promise<void> {
    return this.start(this.snap.meta?.ai ?? 0)
  }

  /** 整備時換零件；換了會超過預算時不做事。組裝立即存檔，下一局帶入 */
  pickPart(slot: PartSlot, id: string): void {
    const r = this.round
    if (!r || r.slot === null || this.phase() !== 'prep') return
    const build = swapPart(r.build, slot, id)
    if (!build) return
    this.engine.setBuild(build)
    this.round = { ...r, build, buildDirty: true }
    this.mountGrid()
    this.refresh()
  }

  /** 單人按「出發」：結束整備，進入起跑倒數 */
  go(): void {
    this.link.ready().catch((error: unknown) => this.report(error))
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
    if (r && r.slot !== null) this.mount(r, respawnPose(r.course, r.cp, r.slot))
  }

  /** 騎上腳踏車，性能依這一局要用的組裝 */
  private mount(r: Round, pose: Pose): void {
    const ridden = this.rideBuild(r)
    this.round = { ...r, ridden }
    this.engine.mountBike(pose, bikeSpec(ridden))
  }

  /** 整備與倒數時組裝變了：在起跑格換上新的腳踏車 */
  private mountGrid(): void {
    const r = this.round
    if (!r || r.slot === null || !this.active) return
    const ridden = this.rideBuild(r)
    if (r.ridden && sameBuild(r.ridden, ridden)) return
    this.mount(r, r.course.grid[r.slot]!)
  }

  /** 整備時用自己剛選的；整備結束後用伺服器上的，其他人看到的就是自己騎的 */
  private rideBuild(r: Round, phase = this.phase()): Build {
    if (phase === 'prep') return r.build
    return this.confirmedBuild(r, this.link.selfId) ?? r.build
  }

  private confirmedBuild(r: Round, id: string): Build | undefined {
    const b = this.snap.build[id]
    if (b?.n !== r.meta.n) return undefined
    const { n: _, ...build } = b
    return build
  }

  /** 競速模式的 onExit：只留背景掛點，下車站在腳踏車旁 */
  exit(): void {
    this.active = false
    this.engine.setHooks(this.background)
    this.engine.dismountBike()
  }

  /** 目前畫面上的 AI：房主用自己算的，其他人用收到的同步資料落後 INTERP_DELAY 內插 */
  aiRiders(): AiPose[] {
    const r = this.round
    if (!r) return []
    if (this.simulatingAis(r)) {
      return r.ais.map((a) => ({ pos: a.bike.pos, heading: a.bike.heading, cp: a.cp, fin: a.fin }))
    }
    const t = this.link.serverNow() - INTERP_DELAY
    return Array.from({ length: r.meta.ai }, (_, k) => this.aiSamples.get(String(k)))
      .filter((s): s is readonly AiSample[] => s !== undefined)
      .map((s) => interpolateAi(s, t))
  }

  /** 仍在房內、還沒完成的其他參賽玩家的位置（小地圖用） */
  rivals(): Vec2[] {
    return this.otherRacers()
      .filter((o) => !o.fin)
      .map((o) => o.pos)
  }

  private simulatingAis(r: Round): boolean {
    return r.aiLive && this.link.isHost()
  }

  /** 仍在房內、還沒完成的其他參賽玩家，位置不知道的不算 */
  private otherRacers(): { pos: Vec2; fin: boolean }[] {
    const r = this.round
    if (!r) return []
    return this.presentEntrants(r)
      .filter((id) => id !== this.link.selfId)
      .flatMap((id) => {
        const pos = this.options.positionOf?.(id) ?? null
        return pos ? [{ pos, fin: this.theirProgress(r, id)?.fin !== undefined }] : []
      })
  }

  private presentEntrants(r: Round): string[] {
    const present = new Set(this.link.roster().map((e) => e.id))
    return Object.keys(r.meta.entrants).filter((id) => present.has(id))
  }

  private theirProgress(r: Round, id: string): Progress | undefined {
    const p = this.snap.progress[id]
    return p?.n === r.meta.n ? p : undefined
  }

  private onSnapshot(snap: RaceSnapshot): void {
    this.snap = snap
    const meta = snap.meta
    if (!meta && this.round) this.dropRound()
    else if (meta && meta.n !== this.round?.meta.n) this.beginRound(meta)
    else if (meta && this.round && (meta.at !== this.round.meta.at || meta.ready !== this.round.meta.ready)) this.round = { ...this.round, meta }
    this.recordAiSamples()
    this.refresh()
  }

  /** 每台 AI 的同步資料有變時記一筆，只留最近 INTERP_KEEP 筆 */
  private recordAiSamples(): void {
    const r = this.round
    if (!r) return
    const at = this.link.serverNow()
    for (const [k, a] of Object.entries(this.snap.ai)) {
      if (a.n !== r.meta.n) continue
      const prev = this.aiSamples.get(k) ?? []
      const last = prev.at(-1)
      if (last && last.x === a.x && last.z === a.z && last.h === a.h && last.cp === a.cp && last.fin === a.fin) continue
      this.aiSamples.set(k, [...prev, { ...a, at }].slice(-INTERP_KEEP))
    }
  }

  /** 比賽被刪除：回到城市 */
  private dropRound(): void {
    this.round = null
    this.aiSamples = new Map()
    if (this.active) this.options.switchMode(false)
  }

  private beginRound(meta: RaceMeta): void {
    const course = generateCourse(this.engine.city, meta.n)
    const slot = meta.entrants[this.link.selfId] ?? null
    const host = this.link.isHost()
    const aiBuilds = aiSlots(meta).map((_, k) => aiBuild(course, this.engine.city.seed, k))
    this.aiSamples = new Map()
    this.round = {
      meta,
      course,
      build: this.engine.state.save.build,
      buildDirty: slot !== null,
      ridden: null,
      aiBuilds,
      drivers: aiBuilds.map((build, k) => aiDriver(k, build)),
      slot,
      cp: 0,
      sentCp: 0,
      stopped: false,
      ...this.syncedAis(meta, course),
      aiLive: host,
      aiClock: 0,
      aiSentAt: -Infinity,
      // 倒數期間 AI 不動，先送一次起跑格上的位置讓其他人畫出來
      aiDirty: host,
    }
    if (slot === null) {
      if (this.active) this.options.switchMode(false)
    } else if (this.active) this.mount(this.round, course.grid[slot]!)
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
      if (r && r.slot !== null && this.canRide()) this.mount(r, respawnPose(r.course, r.cp, r.slot))
      return true
    }
    return BLOCKED_ACTIONS.includes(action)
  }

  private afterStep(state: GameState, dt: number): void {
    const r = this.round
    if (!r) return
    const now = this.link.serverNow()
    const phase = this.phase(now)
    if (phase === 'prep' || phase === 'countdown') this.mountGrid()
    if (this.active) this.rideStep(this.round!, state.player, phase, now)
    if (phase === 'prep') this.sendBuild()
    this.sendProgress()
    this.takeOverAis()
    if (this.simulatingAis(this.round!)) {
      if (phase === 'racing') this.stepAis(state, dt, now)
      this.sendAis(now)
    }
    this.refresh(now)
  }

  /** 自己在競速模式中騎車：判斷檢查點，完成或比賽結束後停車 */
  private rideStep(r: Round, p: GameState['player'], phase: RacePhase, now: number): void {
    if (phase === 'racing' && r.fin === undefined && p.mode === 'bike') {
      const cp = advanceCheckpoint(r.course, r.cp, p.pos)
      if (cp !== r.cp) this.round = { ...r, cp, fin: cp === r.course.checkpoints.length ? now : undefined }
    }
    const done = this.round!.fin !== undefined || phase === 'over'
    if (done && !this.round!.stopped) {
      this.round = { ...this.round!, stopped: true }
      this.engine.mountBike({ pos: p.pos, heading: p.heading })
    }
  }

  /** 成為房主時從最後同步的 AI 資料接手推進；不再是房主時停止推進 */
  private takeOverAis(): void {
    const r = this.round!
    const host = this.link.isHost()
    if (host === r.aiLive) return
    if (!host) {
      this.round = { ...r, aiLive: false }
      return
    }
    this.round = { ...r, ...this.syncedAis(r.meta, r.course), aiLive: true, aiClock: 0, aiDirty: true }
  }

  /** 從最後同步的 AI 資料還原；沒有本局資料的 AI 放在起跑格 */
  private syncedAis(meta: RaceMeta, course: Course): Pick<Round, 'ais' | 'aiFin'> {
    const slots = aiSlots(meta)
    const synced = slots.map((_, k) => {
      const a = this.snap.ai[String(k)]
      return a?.n === meta.n ? a : undefined
    })
    const ais = slots.map((s, k): AiRider => {
      const a = synced[k]
      if (!a) return createAi(course, s)
      const pos = { x: a.x, z: a.z }
      return { bike: { pos, heading: a.h, speed: a.s }, wp: a.w, cp: a.cp, anchor: pos, still: 0, fin: a.fin !== undefined }
    })
    return { ais, aiFin: synced.map((a) => a?.fin) }
  }

  /** 一次只送一筆，送的是當下最新的組裝；失敗時下次重送；開新一局等待確認時暫停 */
  private sendBuild(): void {
    const r = this.round
    if (!r || !r.buildDirty || r.slot === null || this.starting || this.sendingBuild) return
    this.round = { ...r, buildDirty: false }
    this.sendingBuild = true
    this.link
      .sendBuild({ n: r.meta.n, ...r.build })
      .catch((error: unknown) => {
        if (this.round?.meta.n === r.meta.n) this.round = { ...this.round, buildDirty: true }
        this.report(error)
      })
      .finally(() => {
        this.sendingBuild = false
      })
  }

  /** 依序上傳：一次只送一筆，每筆比伺服器已確認的多一個檢查點；開新一局等待確認時暫停 */
  private sendProgress(): void {
    const r = this.round
    if (!r || this.starting || this.sending || r.sentCp >= r.cp) return
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
    const self = this.active ? [{ pos: state.player.pos, fin: r.fin !== undefined }] : []
    const humans = [...self, ...this.otherRacers()]
    const traffic = this.engine.trafficObstacles()
    let ais = r.ais
    const aiFin = [...r.aiFin]
    let clock = r.aiClock + dt
    while (clock >= AI_STEP) {
      clock -= AI_STEP
      ais = ais.map((ai, k) => {
        const others = ais.filter((_, j) => j !== k).map((o) => ({ pos: o.bike.pos, fin: o.fin }))
        const next = stepAi(ai, r.drivers[k]!, r.course, AI_STEP, this.engine.city.colliders, [...riderCircles([...humans, ...others]), ...traffic])
        if (next.fin && aiFin[k] === undefined) aiFin[k] = now
        return next
      })
    }
    this.round = { ...r, ais, aiFin, aiClock: clock, aiDirty: true }
  }

  /** 一次只送一筆、間隔至少 AI_SEND_MS；送出的是當下最新的 AI，失敗時下次重送；開新一局等待確認時暫停 */
  private sendAis(now: number): void {
    const r = this.round!
    if (!r.aiDirty || this.starting || this.sendingAi || now - r.aiSentAt < AI_SEND_MS) return
    const net: Record<string, AiNet> = {}
    r.ais.forEach((a, k) => {
      const fin = r.aiFin[k]
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
    this.round = { ...r, aiDirty: false, aiSentAt: now }
    this.sendingAi = true
    this.link
      .sendAi(net)
      .catch((error: unknown) => {
        if (this.round?.meta.n === r.meta.n) this.round = { ...this.round, aiDirty: true }
        this.report(error)
      })
      .finally(() => {
        this.sendingAi = false
      })
  }

  /** 仍在房內的參賽玩家與 AI */
  private standings(): Standing[] {
    const r = this.round
    if (!r) return []
    const humans = this.presentEntrants(r).map((id): Standing => {
      if (id === this.link.selfId) {
        return { id, cp: r.cp, fin: this.myFin(r), dist: distanceToNext(r.course, r.cp, this.engine.state.player.pos) }
      }
      const theirs = this.theirProgress(r, id)
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
    const a = this.snap.ai[String(k)]
    const confirmed = a?.n === r.meta.n ? a.fin : undefined
    return this.simulatingAis(r) ? (confirmed ?? r.aiFin[k]) : confirmed
  }

  /** 本局最早的完成時間，含已離開房間的玩家 */
  private firstFin(): number | undefined {
    const r = this.round
    if (!r) return undefined
    const others = Object.entries(this.snap.progress)
      .filter(([id, p]) => id !== this.link.selfId && p.n === r.meta.n)
      .map(([, p]) => p)
    const ais = Array.from({ length: r.meta.ai }, (_, k) => ({ fin: this.aiFinOf(k) }))
    return firstFinish([{ fin: this.myFin(r) }, ...others, ...ais])
  }

  /** 自己的完成時間：伺服器已寫入時用伺服器的，否則用本機記錄的 */
  private myFin(r: Round): number | undefined {
    return this.theirProgress(r, this.link.selfId)?.fin ?? r.fin
  }

  /** 成績表的組裝：AI 用本局配的，玩家用伺服器上的，自己還沒確認時用自己選的 */
  private buildOf(r: Round, id: string): string | null {
    const k = r.aiBuilds.findIndex((_, j) => aiId(j) === id)
    if (k >= 0) return buildLabel(r.aiBuilds[k]!)
    const build = this.confirmedBuild(r, id) ?? (id === this.link.selfId ? r.build : undefined)
    return build ? buildLabel(build) : null
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
    const elapsed = Math.max(0, (this.myFin(r) ?? now) - go)
    const turn = this.active && r.slot !== null && r.fin === undefined ? nextTurn(r.course, r.cp, this.engine.state.player.pos) : null
    return {
      n: r.meta.n,
      ais: r.meta.ai,
      phase,
      prepLeft: phase === 'prep' && r.meta.ready === undefined ? Math.ceil((prepEnd(r.meta) - now) / 1000) : null,
      build: r.build,
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
          ? ranked.map((s, k) => ({
              rank: k + 1,
              id: s.id,
              name: this.nameOf(s.id),
              build: this.buildOf(r, s.id),
              time: s.fin === undefined ? null : s.fin - go,
            }))
          : null,
      turn: turn?.kind ?? null,
      turnDist: turn ? Math.round(turn.dist / TURN_STEP) * TURN_STEP : 0,
    }
  }

  private report(error: unknown): void {
    const e = error instanceof Error ? error : new Error(String(error))
    if (this.options.onError) this.options.onError(e)
    else throw e
  }
}

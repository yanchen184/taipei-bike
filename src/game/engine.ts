import { formatClock, isNight } from '../sim/clock'
import { NO_AID, type Aid } from '../sim/aid'
import { isDown } from '../sim/bike'
import { generateCity } from '../sim/city'
import type { Circle } from '../sim/collide'
import { canExitHome, doorPrompt, enterHome, exitHome, generateInterior, greeting, homeAt, type Interior } from '../sim/homes'
import {
  callCar,
  canEnterCar,
  createPlayer,
  dismountBike,
  enterCar,
  exitCar,
  mountBike,
  resetCar,
  stepPlayer,
  stowBike,
  summonBike,
  type PlayerInput,
  type PlayerState,
} from '../sim/player'
import { SAVE_KEY, loadSave, recordVisit, serializeSave, shouldSave, type SaveData } from '../sim/save'
import {
  advanceTraffic,
  buildRoutes,
  initTraffic,
  writeVehicleCircles,
  type Route,
  type TrafficState,
} from '../sim/traffic'
import { bikeSpec, type Build } from '../sim/parts'
import type { CityMap, Pose } from '../sim/types'
import type { VehicleSpec } from '../sim/vehicle'

export type CameraMode = 'chase' | 'top'
export type Action = 'interact' | 'callCar' | 'summonBike' | 'reset' | 'camera' | 'horn' | 'menu' | 'close'

/** 分頁切回前景時的單幀上限（秒），避免一次推進太久 */
const MAX_FRAME = 0.1
const NO_INPUT: Omit<PlayerInput, 'cameraYaw'> = { forward: 0, right: 0, run: false, handbrake: false }

export interface GameState {
  t: number
  player: PlayerState
  traffic: TrafficState
  cameraMode: CameraMode
  cameraYaw: number
  save: SaveData
  hornCount: number
  bookOpen: boolean
}

export interface HudSnapshot {
  clock: string
  night: boolean
  mode: PlayerState['mode']
  speedKmh: number
  /** 騎車摔倒、還躺在地上 */
  fallen: boolean
  /** 騎車時的體力百分比（0–100 整數），沒騎車時為 null */
  stamina: number | null
  /** 騎到沒力了，踩不動 */
  spent: boolean
  prompt: string | null
  greeting: string | null
  placeLabel: string | null
  /** 所在住家的 id，戶外為 null */
  homeId: string | null
  cameraMode: CameraMode
  bookOpen: boolean
  visited: number
}

/** 玩法模式掛在引擎上的擴充點 */
export interface EngineHooks {
  /** 額外的碰撞圓（戶外開車或騎車時才算） */
  obstacles?(): readonly Circle[]
  /** 回傳 false 時本幀輸入歸零 */
  controls?(): boolean
  /** 回傳 true 表示已處理，引擎不再處理 */
  action?(action: Action): boolean
  afterStep?(state: GameState, dt: number): void
  /** 騎車時的破風、後追加成 */
  aid?(): Aid
}

export interface Storage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface EngineOptions {
  seed: number
  name: string
  storage: Storage
  /** 現在的毫秒時間，用來排自動存檔 */
  now: () => number
  /** 連線時由伺服器時間決定世界時間；單人時不給，用累積的 dt */
  worldTime?: () => number
  onHorn?: () => void
}

function hudEqual(a: HudSnapshot, b: HudSnapshot): boolean {
  return (Object.keys(a) as (keyof HudSnapshot)[]).every((k) => a[k] === b[k])
}

export class GameEngine {
  readonly city: CityMap
  readonly routes: Route[]
  /** 讀到的存檔不能用、已改用新存檔 */
  readonly saveWasReset: boolean
  private current: GameState
  private hud: HudSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly options: EngineOptions
  private lastSavedAt = 0
  private savedSnapshot: SaveData | null = null
  private interiorCache: { id: string; room: Interior; city: CityMap } | null = null
  private readonly obstacleBuffer: Circle[] = []
  private hooks: EngineHooks | null = null

  constructor(options: EngineOptions) {
    this.options = options
    this.city = generateCity(options.seed)
    this.routes = buildRoutes(this.city)
    const loaded = loadSave(options.storage.getItem(SAVE_KEY))
    this.saveWasReset = loaded.reset
    const save = { ...loaded.save, name: options.name }
    const player = createPlayer(this.city)
    this.current = {
      t: options.worldTime?.() ?? 0,
      player,
      traffic: initTraffic(this.city),
      cameraMode: 'chase',
      cameraYaw: player.heading,
      save,
      hornCount: 0,
      bookOpen: false,
    }
    this.current = { ...this.current, traffic: advanceTraffic(this.current.traffic, this.routes, this.current.t) }
    this.persist(save)
    this.hud = this.buildHud()
  }

  get state(): GameState {
    return this.current
  }

  getHud = (): HudSnapshot => this.hud

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 目前所在住家的室內（戶外時為 null） */
  interior(): { home: CityMap['homes'][number]; room: Interior } | null {
    const loc = this.current.player.location
    if (loc.kind !== 'home') return null
    const home = homeAt(this.city, loc.homeId)
    if (!home) return null
    return { home, room: this.interiorFor(home.id).room }
  }


  update(frameDt: number, input: Omit<PlayerInput, 'cameraYaw'>): void {
    const dt = Math.min(Math.max(frameDt, 0), MAX_FRAME)
    const t = this.options.worldTime?.() ?? this.current.t + dt
    const traffic = t >= this.current.traffic.t ? advanceTraffic(this.current.traffic, this.routes, t) : advanceTraffic(initTraffic(this.city), this.routes, t)

    const before = this.current.player
    const loc = before.location
    const outdoors = loc.kind === 'outdoor'
    const map = loc.kind === 'home' ? this.interiorFor(loc.homeId).city : this.city
    const hooks = this.hooks
    const riding = outdoors && before.mode !== 'walk'
    const extra = riding ? (hooks?.obstacles?.() ?? []) : []
    const npc = riding ? this.npcObstacles(traffic) : []
    const obstacles = extra.length === 0 ? npc : [...npc, ...extra]
    const controlled = hooks?.controls?.() ?? true
    const full: PlayerInput = { ...(controlled ? input : NO_INPUT), cameraYaw: this.current.cameraYaw }
    const aid = riding ? (hooks?.aid?.() ?? NO_AID) : NO_AID
    const player = stepPlayer(before, full, dt, map, obstacles, aid)

    const save = { ...this.current.save, odometer: player.odometer }
    this.current = { ...this.current, t, traffic, player, cameraYaw: this.followYaw(player, dt), save }
    this.persist(save)
    hooks?.afterStep?.(this.current, dt)
    this.emit()
  }

  rotateCamera(delta: number): void {
    this.current = { ...this.current, cameraYaw: this.current.cameraYaw + delta }
  }

  setHooks(hooks: EngineHooks | null): void {
    this.hooks = hooks
  }

  /** 本幀 NPC 車輛的碰撞圓；下一次 update 會覆寫同一個陣列 */
  trafficObstacles(): readonly Circle[] {
    return this.npcObstacles(this.current.traffic)
  }

  /** 在指定位置騎上腳踏車（速度 0、移到戶外），汽車留在原地；給 spec 時換成這個性能 */
  mountBike(pose: Pose, spec?: VehicleSpec): void {
    this.setPlayer(mountBike(this.current.player, pose, spec), pose.heading)
    this.emit()
  }

  /** 記下整備完的組裝，立即存檔 */
  setBuild(build: Build): void {
    const save = { ...this.current.save, build }
    this.current = { ...this.current, save }
    this.persist(save)
  }

  /** 商店按「裝上」：存下組裝；正在騎車時原地換成新組裝的腳踏車 */
  equip(build: Build): void {
    this.setBuild(build)
    const p = this.current.player
    if (p.mode === 'bike' && p.bike) this.setPlayer(mountBike(p, { pos: p.bike.pos, heading: p.bike.heading }, bikeSpec(build)))
    this.emit()
  }

  /** 下腳踏車，站在車旁 */
  dismountBike(): void {
    this.setPlayer(dismountBike(this.current.player, this.city))
    this.emit()
  }

  action(action: Action): void {
    if (this.hooks?.action?.(action)) {
      this.emit()
      return
    }
    const s = this.current
    switch (action) {
      case 'interact':
        this.interact()
        break
      case 'callCar':
        if (s.player.mode === 'walk' && s.player.location.kind === 'outdoor') this.setPlayer(callCar(s.player, this.city))
        break
      case 'summonBike':
        if (s.player.mode !== 'drive' && s.player.location.kind === 'outdoor') {
          const player = summonBike(s.player, this.city, bikeSpec(s.save.build))
          this.setPlayer(player, player.heading)
        }
        break
      case 'reset':
        if (s.player.mode === 'drive') this.setPlayer(resetCar(s.player, this.city))
        break
      case 'camera':
        this.current = { ...s, cameraMode: s.cameraMode === 'chase' ? 'top' : 'chase' }
        break
      case 'horn':
        if (s.player.mode === 'drive') {
          this.current = { ...s, hornCount: s.hornCount + 1 }
          this.options.onHorn?.()
        }
        break
      case 'menu':
        this.current = { ...s, bookOpen: !s.bookOpen }
        break
      case 'close':
        this.current = { ...s, bookOpen: false }
        break
    }
    this.emit()
  }

  /** 測試掛鉤用：瞬移玩家（開車或騎車時連車一起） */
  teleport(x: number, z: number, heading = this.current.player.heading): void {
    const p = this.current.player
    const pos = { x, z }
    const player: PlayerState =
      p.mode === 'drive'
        ? { ...p, pos, heading, car: { ...p.car, pos, heading, speed: 0 } }
        : p.mode === 'bike' && p.bike
          ? { ...p, pos, heading, bike: { ...p.bike, pos, heading, speed: 0 } }
          : { ...p, pos, heading, location: { kind: 'outdoor' } }
    this.current = { ...this.current, player, cameraYaw: heading }
    this.emit()
  }

  setTime(t: number): void {
    this.current = { ...this.current, t, traffic: advanceTraffic(initTraffic(this.city), this.routes, t) }
    this.emit()
  }

  private interact(): void {
    const p = this.current.player
    if (p.location.kind === 'home') {
      const out = exitHome(p, this.city)
      if (out) this.setPlayer(out, out.heading)
      return
    }
    if (p.mode === 'drive') {
      this.setPlayer(exitCar(p, this.city))
      return
    }
    if (p.mode === 'bike') {
      this.setPlayer(stowBike(p, this.city))
      return
    }
    const prompt = doorPrompt(p, this.city)
    const inside = prompt ? enterHome(p, this.city) : null
    if (prompt && inside) {
      const save = recordVisit(this.current.save, prompt.home.id)
      this.setPlayer(inside, Math.PI)
      this.current = { ...this.current, save }
      this.persist(save)
      return
    }
    const driving = enterCar(p)
    if (driving) this.setPlayer(driving, driving.heading)
  }

  private setPlayer(player: PlayerState, cameraYaw = this.current.cameraYaw): void {
    this.current = { ...this.current, player, cameraYaw }
  }

  private followYaw(player: PlayerState, dt: number): number {
    const yaw = this.current.cameraYaw
    const vehicle = player.mode === 'drive' ? player.car : player.mode === 'bike' ? player.bike : null
    if (!vehicle || vehicle.speed < 0.5) return yaw
    let d = (vehicle.heading - yaw) % (2 * Math.PI)
    if (d > Math.PI) d -= 2 * Math.PI
    if (d < -Math.PI) d += 2 * Math.PI
    return yaw + d * Math.min(1, dt * 4)
  }

  /** 本幀 NPC 車輛的碰撞圓，重用同一個陣列 */
  private npcObstacles(traffic: TrafficState): readonly Circle[] {
    const buffer = this.obstacleBuffer
    buffer.length = writeVehicleCircles(this.routes, traffic.vehicles, buffer)
    return buffer
  }

  private interiorFor(homeId: string): { room: Interior; city: CityMap } {
    if (this.interiorCache?.id !== homeId) {
      const home = homeAt(this.city, homeId)
      if (!home) throw new Error(`unknown home ${homeId}`)
      const room = generateInterior(home)
      this.interiorCache = { id: homeId, room, city: { ...this.city, colliders: room.colliders } }
    }
    return this.interiorCache
  }

  private persist(save: SaveData): void {
    const nowMs = this.options.now()
    const prev = this.savedSnapshot
    if (prev && !shouldSave(prev, save, this.lastSavedAt, nowMs)) return
    this.options.storage.setItem(SAVE_KEY, serializeSave(save))
    this.savedSnapshot = save
    this.lastSavedAt = nowMs
  }

  private buildHud(): HudSnapshot {
    const s = this.current
    const p = s.player
    const inside = this.interior()
    let prompt: string | null = null
    let greet: string | null = null
    if (inside) {
      if (canExitHome(p, inside.room)) prompt = '按 E 出門'
      greet = greeting(inside.room, inside.home, p.pos)
    } else if (p.mode === 'walk') {
      prompt = doorPrompt(p, this.city)?.text ?? (canEnterCar(p) ? '按 E 上車' : null)
    }
    return {
      clock: formatClock(s.t),
      night: isNight(s.t),
      mode: p.mode,
      speedKmh: Math.round(Math.abs((p.mode === 'bike' ? p.bike?.speed : p.car.speed) ?? 0) * 3.6),
      fallen: p.mode === 'bike' && p.bike !== null && isDown(p.bike),
      stamina: p.mode === 'bike' && p.bike !== null ? Math.round(p.bike.stamina.level * 100) : null,
      spent: p.mode === 'bike' && p.bike !== null && p.bike.stamina.spent,
      prompt,
      greeting: greet,
      placeLabel: inside ? inside.home.address : null,
      homeId: inside ? inside.home.id : null,
      cameraMode: s.cameraMode,
      bookOpen: s.bookOpen,
      visited: s.save.visited.length,
    }
  }

  private emit(): void {
    const next = this.buildHud()
    if (hudEqual(next, this.hud)) return
    this.hud = next
    this.listeners.forEach((l) => l())
  }
}

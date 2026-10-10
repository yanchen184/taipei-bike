import { formatClock, isNight } from '../sim/clock'
import { generateCity } from '../sim/city'
import type { Circle } from '../sim/collide'
import { canExitHome, doorPrompt, enterHome, exitHome, generateInterior, greeting, homeAt, type Interior } from '../sim/homes'
import {
  callCar,
  canEnterCar,
  createPlayer,
  enterCar,
  exitCar,
  resetCar,
  stepPlayer,
  type PlayerInput,
  type PlayerState,
} from '../sim/player'
import { SAVE_KEY, loadSave, recordVisit, serializeSave, shouldSave, type SaveData } from '../sim/save'
import {
  VEHICLE_SPEC,
  advanceTraffic,
  buildRoutes,
  initTraffic,
  writeVehiclePos,
  type Route,
  type TrafficState,
} from '../sim/traffic'
import type { CityMap } from '../sim/types'

export type CameraMode = 'chase' | 'top'
export type Action = 'interact' | 'callCar' | 'reset' | 'camera' | 'horn' | 'menu' | 'close'

/** 分頁切回前景時的單幀上限（秒），避免一次推進太久 */
const MAX_FRAME = 0.1

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
  prompt: string | null
  greeting: string | null
  placeLabel: string | null
  /** 所在住家的 id，戶外為 null */
  homeId: string | null
  cameraMode: CameraMode
  bookOpen: boolean
  visited: number
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
    const obstacles = outdoors && before.mode === 'drive' ? this.npcObstacles(traffic) : []
    const full: PlayerInput = { ...input, cameraYaw: this.current.cameraYaw }
    const player = stepPlayer(before, full, dt, map, obstacles)

    const save = { ...this.current.save, odometer: player.odometer }
    this.current = { ...this.current, t, traffic, player, cameraYaw: this.followYaw(player, dt), save }
    this.persist(save)
    this.emit()
  }

  rotateCamera(delta: number): void {
    this.current = { ...this.current, cameraYaw: this.current.cameraYaw + delta }
  }

  action(action: Action): void {
    const s = this.current
    switch (action) {
      case 'interact':
        this.interact()
        break
      case 'callCar':
        if (s.player.mode === 'walk' && s.player.location.kind === 'outdoor') this.setPlayer(callCar(s.player, this.city))
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

  /** 測試掛鉤用：瞬移玩家（開車時連車一起） */
  teleport(x: number, z: number, heading = this.current.player.heading): void {
    const p = this.current.player
    const pos = { x, z }
    const player: PlayerState =
      p.mode === 'drive'
        ? { ...p, pos, heading, car: { ...p.car, pos, heading, speed: 0 } }
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
    if (player.mode !== 'drive' || player.car.speed < 0.5) return yaw
    let d = (player.car.heading - yaw) % (2 * Math.PI)
    if (d > Math.PI) d -= 2 * Math.PI
    if (d < -Math.PI) d += 2 * Math.PI
    return yaw + d * Math.min(1, dt * 4)
  }

  /** 本幀 NPC 車輛的碰撞圓，重用同一個陣列 */
  private npcObstacles(traffic: TrafficState): readonly Circle[] {
    const buffer = this.obstacleBuffer
    traffic.vehicles.forEach((v, k) => {
      const circle = (buffer[k] ??= { pos: { x: 0, z: 0 }, radius: 0 })
      writeVehiclePos(this.routes, v, circle.pos)
      circle.radius = VEHICLE_SPEC[v.kind].radius
    })
    buffer.length = traffic.vehicles.length
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
      speedKmh: Math.round(Math.abs(p.car.speed) * 3.6),
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

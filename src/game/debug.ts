import type * as THREE from 'three'
import { readNightGlow } from '../render/materials'
import { sceneSurfaces, type SceneSurfaces } from '../render/sceneProbe'
import { textureStatus } from '../render/textures'
import { hornPlayCount } from './audio'
import type { RaceController, RaceView } from '../modes/race/controller'
import type { PlayerState } from '../sim/player'
import type { Pose, Vec2 } from '../sim/types'
import type { GameEngine, GameState } from './engine'
import type { OnlineSession, RosterEntry } from './online'

export interface DebugDoor {
  id: string
  address: string
  door: { x: number; z: number }
  facing: number
}

/** E2E 與線上驗收用的測試掛鉤 */
export interface TaipeiDebug {
  state(): Omit<GameState, 'traffic'>
  teleport(x: number, z: number, heading?: number): void
  setTime(t: number): void
  doors(): DebugDoor[]
  lighting(): ReturnType<typeof readNightGlow>
  hornPlays(): number
  /** 每張貼圖的實際尺寸；未載入時為 0 */
  textures(): ReturnType<typeof textureStatus>
  /** 畫面上可見 mesh 實際綁定的貼圖與發光材質；場景未建立時為空 */
  surfaces(): SceneSurfaces
  /** 畫面上正在畫的其他玩家與補間後的位置；單人時為空 */
  remotes(): DebugRemote[]
  /** 房號與房內名單；單人時為 null */
  room(): { code: string; uid: string; seed: number; players: readonly RosterEntry[] } | null
  /** 目前這一局；還沒有參加過比賽時為 null */
  race(): DebugRace | null
  /** 場景中是否有這個名字的物件 */
  hasObject(name: string): boolean
  /** 這個名字的物件畫在畫面上時的世界座標；不存在或本身、上層被隱藏時為 null */
  shown(name: string): Vec2 | null
}

export interface DebugRace {
  view: RaceView
  slot: number
  grid: Pose[]
  checkpoints: Vec2[]
  ais: { x: number; z: number; cp: number; fin: boolean }[]
  /** 畫面上檢查點標示的位置；沒有畫時為 null */
  marker: Vec2 | null
}

export interface DebugRemote {
  uid: string
  name: string
  x: number
  z: number
  mode: PlayerState['mode']
  loc: string
}

declare global {
  interface Window {
    __taipei?: TaipeiDebug
  }
}

export function debugEnabled(location: Location): boolean {
  return import.meta.env.DEV || new URLSearchParams(location.search).get('debug') === '1'
}

/** 掛上 window.__taipei，回傳卸載函式 */
export function installDebug(
  target: Window,
  engine: GameEngine,
  online: OnlineSession | null,
  scene: THREE.Scene | null,
  race: RaceController,
): () => void {
  target.__taipei = {
    state: () => {
      const { traffic: _traffic, ...rest } = engine.state
      return structuredClone(rest)
    },
    teleport: (x, z, heading) => engine.teleport(x, z, heading),
    setTime: (t) => engine.setTime(t),
    doors: () => engine.city.homes.map((h) => ({ id: h.id, address: h.address, door: h.door, facing: h.facing })),
    lighting: readNightGlow,
    hornPlays: hornPlayCount,
    textures: textureStatus,
    surfaces: () => (scene ? sceneSurfaces(scene) : { maps: [], glowing: [] }),
    remotes: () => {
      if (!online) return []
      const names = new Map(online.store.getRoster().map((p) => [p.uid, p.name]))
      return [...online.store.rendered].map(([uid, s]) => ({ uid, name: names.get(uid) ?? '', x: s.x, z: s.z, mode: s.mode, loc: s.loc }))
    },
    room: () =>
      online && { code: online.link.code, uid: online.link.uid, seed: online.link.meta.seed, players: online.store.getRoster() },
    hasObject: (name) => scene?.getObjectByName(name) !== undefined,
    shown: (name) => {
      const object = scene?.getObjectByName(name)
      if (!object) return null
      for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return null
      object.updateWorldMatrix(true, false)
      const e = object.matrixWorld.elements
      return { x: e[12]!, z: e[14]! }
    },
    race: () => {
      const course = race.course()
      const slot = race.slot()
      if (!course || slot === null) return null
      const marker = scene?.getObjectByName('race-checkpoint')
      return structuredClone({
        view: race.view(),
        slot,
        grid: course.grid,
        checkpoints: course.checkpoints.map((k) => course.nodes[k]!),
        ais: race.aiRiders().map((a) => ({ x: a.pos.x, z: a.pos.z, cp: a.cp, fin: a.fin })),
        marker: marker ? { x: marker.position.x, z: marker.position.z } : null,
      })
    },
  }
  return () => {
    delete target.__taipei
  }
}

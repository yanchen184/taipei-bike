import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { useEngine } from '../game/EngineContext'
import { rect, segmentHitsRect } from '../sim/collide'
import type { Interior } from '../sim/homes'
import type { Rect } from '../sim/types'
import { AvatarModel } from './PlayerView'
import { tiled } from './textures'

const WALL_HEIGHT = 3
/** 擋在相機與玩家之間的牆降到這個高度 */
const CUTAWAY_HEIGHT = 0.4
const DOOR_WIDTH = 1.1
const DOOR_HEIGHT = 2.2
const DOOR_THICKNESS = 0.05
/** 一張地板貼圖代表的邊長（m） */
const FLOOR_TILE = 2

interface RectBoxProps {
  r: Rect
  height: number
  color: string
  map?: THREE.Texture
}

function RectBox({ r, height, color, map }: RectBoxProps) {
  return (
    <mesh position={[(r.minX + r.maxX) / 2, height / 2, (r.minZ + r.maxZ) / 2]}>
      <boxGeometry args={[r.maxX - r.minX, height, r.maxZ - r.minZ]} />
      <meshLambertMaterial color={color} map={map ?? null} />
    </mesh>
  )
}

type Cuttable = RectBoxProps

/** 牆與門：擋住相機視線時從底部縮成矮牆 */
function CutawayWalls({ items }: { items: readonly Cuttable[] }) {
  const engine = useEngine()
  const groups = useRef<(THREE.Group | null)[]>([])
  const eye = useMemo(() => ({ x: 0, z: 0 }), [])

  useFrame(({ camera }) => {
    const player = engine.state.player.pos
    eye.x = camera.position.x
    eye.z = camera.position.z
    items.forEach((item, k) => {
      const group = groups.current[k]
      if (!group) return
      const blocking = segmentHitsRect(eye, player, item.r)
      group.scale.y = blocking ? Math.min(1, CUTAWAY_HEIGHT / item.height) : 1
    })
  })

  return (
    <>
      {items.map((item, k) => (
        <group key={k} ref={(g) => void (groups.current[k] = g)}>
          <RectBox {...item} />
        </group>
      ))}
    </>
  )
}

/** 室內使用自己的座標（x 0..width、z 0..depth），畫在原點，城市此時不畫 */
export function InteriorView({ room }: { room: Interior }) {
  const wallMap = useMemo(() => tiled('interiorWall', 1, 1), [])
  const floorMap = useMemo(() => tiled('interiorFloor', room.width / FLOOR_TILE, room.depth / FLOOR_TILE), [room])
  const cuttables = useMemo<Cuttable[]>(
    () => [
      ...room.walls.map((r) => ({ r, height: WALL_HEIGHT, color: room.wallColor, map: wallMap })),
      {
        r: rect(room.door.x - DOOR_WIDTH / 2, room.depth - DOOR_THICKNESS - 0.01, room.door.x + DOOR_WIDTH / 2, room.depth - 0.01),
        height: DOOR_HEIGHT,
        color: '#7a4e2d',
      },
    ],
    [room, wallMap],
  )
  useEffect(() => () => wallMap.dispose(), [wallMap])
  useEffect(() => () => floorMap.dispose(), [floorMap])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[room.width / 2, 0, room.depth / 2]}>
        <planeGeometry args={[room.width, room.depth]} />
        <meshLambertMaterial color={room.floorColor} map={floorMap} />
      </mesh>
      <CutawayWalls items={cuttables} />
      {room.furniture.map((f) => (
        <RectBox key={f.kind} r={f.rect} height={f.height} color={f.color} />
      ))}
      <group position={[room.resident.pos.x, 0, room.resident.pos.z]} name="resident">
        <AvatarModel color="#d9534f" />
      </group>
      <pointLight position={[room.width / 2, WALL_HEIGHT - 0.3, room.depth / 2]} intensity={12} distance={20} />
    </group>
  )
}

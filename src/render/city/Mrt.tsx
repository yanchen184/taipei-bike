import { useMemo } from 'react'
import * as THREE from 'three'
import type { CityMap } from '../../sim/types'
import { Instanced, type Placement } from '../Instanced'
import { plateFaces, plateWidth } from './Signs'

const DECK_WIDTH = 8
const DECK_THICKNESS = 1.2
const STATION_HEIGHT = 6
const STATION_ROOF = 0.6
const NAME_HEIGHT = 1.4
const NAME_CHAR = 1.1
const NAME_COLORS = { bg: '#1d5fae', fg: '#ffffff' }

const concrete = new THREE.MeshLambertMaterial({ color: '#c5c3bd' })
const station = new THREE.MeshLambertMaterial({ color: '#e8e6df' })
const roof = new THREE.MeshLambertMaterial({ color: '#2f6f9f' })

/** 高架捷運：沿某條南北向道路中線的橋面、橋墩與車站 */
export function Mrt({ city }: { city: CityMap }) {
  const { mrt } = city
  const road = city.roads.find((r) => r.id === mrt.roadId)
  const parts = useMemo(() => {
    const pillars = mrt.pillars.map(
      (r): Placement => ({
        x: (r.minX + r.maxX) / 2,
        y: 0,
        z: (r.minZ + r.maxZ) / 2,
        sx: r.maxX - r.minX,
        sy: mrt.height,
        sz: r.maxZ - r.minZ,
      }),
    )
    const stations = mrt.stations.map(
      (r): Placement => ({
        x: (r.minX + r.maxX) / 2,
        y: mrt.height + DECK_THICKNESS,
        z: (r.minZ + r.maxZ) / 2,
        sx: r.maxX - r.minX,
        sy: STATION_HEIGHT,
        sz: r.maxZ - r.minZ,
      }),
    )
    const roofs = stations.map((s): Placement => ({ ...s, y: s.y + STATION_HEIGHT, sx: s.sx + 1, sy: STATION_ROOF, sz: s.sz + 1 }))
    return { pillars, stations, roofs }
  }, [mrt])
  if (!road) return null
  return (
    <group>
      <mesh position={[road.center, mrt.height + DECK_THICKNESS / 2, city.size / 2]} material={concrete}>
        <boxGeometry args={[DECK_WIDTH, DECK_THICKNESS, city.size]} />
      </mesh>
      <Instanced items={parts.pillars} material={concrete} />
      <Instanced items={parts.stations} material={station} />
      <Instanced items={parts.roofs} material={roof} />
      {parts.stations.map((s, k) => {
        const name = `${mrt.name} ${mrt.stationNames[k]}站`
        // 一塊橫穿車站的牌子，東西兩面露在站體外
        return (
          <mesh key={name} position={[s.x, s.y + STATION_HEIGHT / 2, s.z]} rotation={[0, Math.PI / 2, 0]} material={plateFaces(name, NAME_COLORS)}>
            <boxGeometry args={[plateWidth(name, NAME_CHAR), NAME_HEIGHT, s.sx + 0.2]} />
          </mesh>
        )
      })}
    </group>
  )
}

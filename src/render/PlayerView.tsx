import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type * as THREE from 'three'
import { useEngine } from '../game/EngineContext'
import { BikeModel, BikeRider } from './BikeModel'
import { glow } from './materials'

const WHEELS: readonly (readonly [number, number])[] = [
  [-0.95, 1.4],
  [0.95, 1.4],
  [-0.95, -1.4],
  [0.95, -1.4],
]

/** 黃色計程車：車身、車廂、車頂燈、車頭燈、四輪 */
export function TaxiModel() {
  return (
    <group>
      <mesh position={[0, 0.75, 0]}>
        <boxGeometry args={[1.9, 0.7, 4.4]} />
        <meshLambertMaterial color="#f5c518" />
      </mesh>
      <mesh position={[0, 1.4, -0.2]}>
        <boxGeometry args={[1.7, 0.6, 2.3]} />
        <meshLambertMaterial color="#2c3640" />
      </mesh>
      <mesh position={[0, 1.8, -0.2]}>
        <boxGeometry args={[0.7, 0.2, 0.3]} />
        <meshLambertMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 0.8, 2.21]} material={glow.headlight}>
        <boxGeometry args={[1.5, 0.2, 0.05]} />
      </mesh>
      {WHEELS.map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 0.38, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.38, 0.38, 0.3, 12]} />
          <meshLambertMaterial color="#1b1b1b" />
        </mesh>
      ))}
    </group>
  )
}

/** 小人：身體、頭；color 區分玩家 */
export function AvatarModel({ color = '#2f7de1' }: { color?: string }) {
  return (
    <group>
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[0.5, 0.9, 0.3]} />
        <meshLambertMaterial color="#2e3440" />
      </mesh>
      <mesh position={[0, 1.25, 0]}>
        <boxGeometry args={[0.6, 0.6, 0.35]} />
        <meshLambertMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.8, 0]}>
        <sphereGeometry args={[0.25, 12, 10]} />
        <meshLambertMaterial color="#f1c9a5" />
      </mesh>
    </group>
  )
}

/** 自己的車、腳踏車與角色；室內時不畫車 */
export function PlayerView() {
  const engine = useEngine()
  const car = useRef<THREE.Group>(null)
  const avatar = useRef<THREE.Group>(null)
  const bike = useRef<THREE.Group>(null)
  const rider = useRef<THREE.Group>(null)

  useFrame(() => {
    const p = engine.state.player
    const indoors = p.location.kind === 'home'
    if (car.current) {
      car.current.visible = !indoors
      car.current.position.set(p.car.pos.x, 0, p.car.pos.z)
      car.current.rotation.y = p.car.heading
    }
    if (bike.current) {
      bike.current.visible = !indoors && p.bike !== null
      if (p.bike) {
        bike.current.position.set(p.bike.pos.x, 0, p.bike.pos.z)
        // 轉彎往彎內傾、摔車倒在地上：沿車身前後軸滾轉
        bike.current.rotation.set(0, p.bike.heading, p.bike.lean)
      }
    }
    if (rider.current) rider.current.visible = p.mode === 'bike'
    if (avatar.current) {
      avatar.current.visible = p.mode === 'walk'
      avatar.current.position.set(p.pos.x, 0, p.pos.z)
      avatar.current.rotation.y = p.heading
    }
  })

  return (
    <group>
      <group ref={car} name="player-car">
        <TaxiModel />
      </group>
      <group ref={bike} name="player-bike">
        <BikeModel />
        <group ref={rider}>
          <BikeRider />
        </group>
      </group>
      <group ref={avatar} name="player-avatar">
        <AvatarModel />
      </group>
    </group>
  )
}

import { AvatarModel } from './PlayerView'

const WHEEL_Z = [0.55, -0.55] as const

/** 腳踏車：車架、把手、兩輪 */
export function BikeModel() {
  return (
    <group>
      <mesh position={[0, 0.6, 0]}>
        <boxGeometry args={[0.08, 0.08, 1.1]} />
        <meshLambertMaterial color="#d6332f" />
      </mesh>
      <mesh position={[0, 0.85, 0.5]}>
        <boxGeometry args={[0.6, 0.06, 0.06]} />
        <meshLambertMaterial color="#2b2b2b" />
      </mesh>
      {WHEEL_Z.map((z) => (
        <mesh key={z} position={[0, 0.35, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.35, 0.35, 0.08, 16]} />
          <meshLambertMaterial color="#1b1b1b" />
        </mesh>
      ))}
    </group>
  )
}

/** 坐在腳踏車上的小人 */
export function BikeRider({ color }: { color?: string }) {
  return (
    <group position={[0, 0.35, -0.1]}>
      <AvatarModel color={color} />
    </group>
  )
}

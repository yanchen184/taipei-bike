import { useMemo } from 'react'
import * as THREE from 'three'

type Point = readonly [number, number, number]

const UP = new THREE.Vector3(0, 1, 0)
const WHEEL_Y = 0.35
const WHEEL_Z = [0.52, -0.52] as const

/** 腳踏車的關鍵點（+z 朝車頭）：五通、座管頂、車頭管上下、後輪軸、前輪軸、把手 */
const BB: Point = [0, 0.32, -0.05]
const SEAT: Point = [0, 0.86, -0.22]
const HEAD_TOP: Point = [0, 0.88, 0.36]
const HEAD_LOW: Point = [0, 0.7, 0.42]
const REAR: Point = [0, WHEEL_Y, -0.52]
const FRONT: Point = [0, WHEEL_Y, 0.52]
const BAR: Point = [0, 0.98, 0.44]

/** 兩點之間的圓管 */
function Tube({ from, to, radius, color }: { from: Point; to: Point; radius: number; color: string }) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    const dir = b.clone().sub(a)
    return {
      position: a.clone().add(b).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()),
      length: dir.length(),
    }
  }, [from, to])
  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[radius, radius, length, 8]} />
      <meshLambertMaterial color={color} />
    </mesh>
  )
}

/** 腳踏車：菱形車架、前叉、座墊、把手、兩輪（輪胎＋輪框） */
export function BikeModel({ color = '#d6332f' }: { color?: string }) {
  return (
    <group>
      <Tube from={SEAT} to={BB} radius={0.03} color={color} />
      <Tube from={BB} to={HEAD_LOW} radius={0.035} color={color} />
      <Tube from={SEAT} to={HEAD_TOP} radius={0.03} color={color} />
      <Tube from={HEAD_TOP} to={HEAD_LOW} radius={0.035} color={color} />
      <Tube from={BB} to={REAR} radius={0.02} color={color} />
      <Tube from={SEAT} to={REAR} radius={0.02} color={color} />
      <Tube from={HEAD_LOW} to={FRONT} radius={0.022} color="#c9c9c9" />
      <Tube from={HEAD_TOP} to={BAR} radius={0.022} color="#2b2b2b" />
      <mesh position={BAR}>
        <boxGeometry args={[0.52, 0.04, 0.04]} />
        <meshLambertMaterial color="#2b2b2b" />
      </mesh>
      <mesh position={[0, SEAT[1] + 0.04, SEAT[2]]}>
        <boxGeometry args={[0.12, 0.05, 0.26]} />
        <meshLambertMaterial color="#1b1b1b" />
      </mesh>
      {WHEEL_Z.map((z) => (
        <group key={z} position={[0, WHEEL_Y, z]} rotation={[0, Math.PI / 2, 0]}>
          <mesh>
            <torusGeometry args={[0.32, 0.04, 8, 24]} />
            <meshLambertMaterial color="#1b1b1b" />
          </mesh>
          <mesh>
            <torusGeometry args={[0.28, 0.012, 6, 24]} />
            <meshLambertMaterial color="#b8b8b8" />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 0.1, 10]} />
            <meshLambertMaterial color="#8a8a8a" />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** 騎士的關節：臀坐在座墊上、上身前傾、手握把手、腳踩踏板 */
const HIP_Y = SEAT[1] + 0.1
const SHOULDER: Point = [0, 1.36, 0.22]
const HIP: Point = [0, HIP_Y, -0.2]
const SKIN = '#f1c9a5'
const SHORTS = '#22252b'

/** 騎在腳踏車上的人：前傾、戴安全帽；color 是車衣與安全帽的顏色 */
export function BikeRider({ color = '#2f7de1' }: { color?: string }) {
  return (
    <group>
      <Tube from={HIP} to={SHOULDER} radius={0.17} color={color} />
      {[-1, 1].map((side) => {
        const hip: Point = [side * 0.11, HIP_Y, -0.18]
        const knee: Point = [side * 0.15, 0.78, 0.14]
        const pedal: Point = [side * 0.15, BB[1] + (side > 0 ? 0.12 : -0.12), BB[2] + (side > 0 ? 0.1 : -0.1)]
        const shoulder: Point = [side * 0.2, SHOULDER[1] - 0.02, SHOULDER[2]]
        const hand: Point = [side * 0.22, BAR[1], BAR[2]]
        return (
          <group key={side}>
            <Tube from={hip} to={knee} radius={0.075} color={SHORTS} />
            <Tube from={knee} to={pedal} radius={0.055} color={SKIN} />
            <Tube from={shoulder} to={hand} radius={0.05} color={SKIN} />
          </group>
        )
      })}
      <mesh position={[0, SHOULDER[1] + 0.17, SHOULDER[2] + 0.1]}>
        <sphereGeometry args={[0.15, 14, 12]} />
        <meshLambertMaterial color={SKIN} />
      </mesh>
      <mesh position={[0, SHOULDER[1] + 0.23, SHOULDER[2] + 0.08]} scale={[1, 0.72, 1.25]}>
        <sphereGeometry args={[0.18, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshLambertMaterial color={color} />
      </mesh>
    </group>
  )
}

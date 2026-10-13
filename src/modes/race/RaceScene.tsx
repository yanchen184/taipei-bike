import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type * as THREE from 'three'
import { BikeModel, BikeRider } from '../../render/BikeModel'
import { useNearCameraFade } from '../../render/nearFade'
import { CHECKPOINT_RADIUS, checkpointPos } from '../../sim/course'
import type { RaceController } from './controller'
import { useRaceView } from './useRaceView'

const AI_COLORS = ['#f0883e', '#a371f7', '#3fb950', '#39c5cf', '#e8554e'] as const
const BEAM_HEIGHT = 30

function AiBike({ controller, k }: { controller: RaceController; k: number }) {
  const group = useRef<THREE.Group>(null)
  useFrame(() => {
    const ai = controller.aiRiders()[k]
    const g = group.current
    if (!g) return
    g.visible = ai !== undefined
    if (!ai) return
    g.position.set(ai.pos.x, 0, ai.pos.z)
    g.rotation.y = ai.heading
  })
  useNearCameraFade(group)
  return (
    <group ref={group} name={`race-ai-${k}`}>
      <BikeModel />
      <BikeRider color={AI_COLORS[k % AI_COLORS.length]} />
    </group>
  )
}

/** 下一個檢查點的光柱與地面圈（終點為紅色），以及 AI 腳踏車 */
export function RaceScene({ controller }: { controller: RaceController }) {
  const view = useRaceView(controller)
  const course = controller.course()
  const next = course && !view.finished && view.cp < course.checkpoints.length ? checkpointPos(course, view.cp) : null
  const color = view.cp === view.cps - 1 ? '#ff4d4f' : '#36cfc9'
  return (
    <group name="race-scene">
      {next && (
        <group name="race-checkpoint" position={[next.x, 0, next.z]}>
          <mesh position={[0, BEAM_HEIGHT / 2, 0]}>
            <cylinderGeometry args={[1.2, 1.2, BEAM_HEIGHT, 16, 1, true]} />
            <meshBasicMaterial color={color} transparent opacity={0.45} depthWrite={false} />
          </mesh>
          <mesh position={[0, 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[CHECKPOINT_RADIUS - 0.6, CHECKPOINT_RADIUS, 48]} />
            <meshBasicMaterial color={color} transparent opacity={0.7} depthWrite={false} />
          </mesh>
        </group>
      )}
      {Array.from({ length: view.ais }, (_, k) => (
        <AiBike key={`${view.n}-${k}`} controller={controller} k={k} />
      ))}
    </group>
  )
}

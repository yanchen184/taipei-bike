import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { VEHICLE_SPEC, writeVehiclePose } from '../sim/traffic'
import { useEngine } from '../game/EngineContext'
import { glow } from './materials'

const CAR_COLORS = ['#e8e8e8', '#2b2d31', '#b8bcc2', '#9b1c1c', '#1f4e8c', '#f2c230']
const SCOOTER_COLORS = ['#d33f3f', '#3f7fd3', '#f0f0f0', '#5aa05a']

const BODY = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
const bodyMaterial = new THREE.MeshLambertMaterial({ color: '#ffffff' })

/** 車身與車頭燈的尺寸（寬、高、長），以車子中心為原點 */
const SHAPE = {
  car: { w: 1.8, h: 1.4, l: VEHICLE_SPEC.car.halfLength * 2 },
  scooter: { w: 0.7, h: 1.2, l: VEHICLE_SPEC.scooter.halfLength * 2 },
} as const

export function TrafficCars() {
  const engine = useEngine()
  const vehicles = engine.state.traffic.vehicles
  const count = vehicles.length
  const bodies = useRef<THREE.InstancedMesh>(null)
  const lights = useRef<THREE.InstancedMesh>(null)
  const colors = useMemo(
    () =>
      vehicles.map((v, k) => new THREE.Color(v.kind === 'car' ? CAR_COLORS[k % CAR_COLORS.length]! : SCOOTER_COLORS[k % SCOOTER_COLORS.length]!)),
    [vehicles],
  )
  const scratch = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), pose: { pos: { x: 0, z: 0 }, heading: 0 } }), [])

  useFrame(() => {
    const b = bodies.current
    const l = lights.current
    if (!b || !l) return
    const { m, q, p, s, up, pose } = scratch
    engine.state.traffic.vehicles.forEach((v, k) => {
      writeVehiclePose(engine.routes, v, pose)
      const shape = SHAPE[v.kind]
      q.setFromAxisAngle(up, pose.heading)
      b.setMatrixAt(k, m.compose(p.set(pose.pos.x, 0.25, pose.pos.z), q, s.set(shape.w, shape.h, shape.l)))
      const fx = Math.sin(pose.heading) * (shape.l / 2)
      const fz = Math.cos(pose.heading) * (shape.l / 2)
      l.setMatrixAt(k, m.compose(p.set(pose.pos.x + fx, 0.7, pose.pos.z + fz), q, s.set(shape.w * 0.8, 0.25, 0.1)))
      b.setColorAt(k, colors[k] ?? colors[0]!)
    })
    b.instanceMatrix.needsUpdate = true
    l.instanceMatrix.needsUpdate = true
    if (b.instanceColor) b.instanceColor.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={bodies} args={[BODY, bodyMaterial, count]} frustumCulled={false} />
      <instancedMesh ref={lights} args={[BODY, glow.headlight, count]} frustumCulled={false} />
    </group>
  )
}

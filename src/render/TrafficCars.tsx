import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { writeVehiclePose, type VehicleKind } from '../sim/traffic'
import { useEngine } from '../game/EngineContext'
import { glow } from './materials'

const CAR_COLORS = ['#e8e8e8', '#2b2d31', '#b8bcc2', '#9b1c1c', '#1f4e8c', '#f2c230']
const SCOOTER_COLORS = ['#d33f3f', '#3f7fd3', '#f0f0f0', '#5aa05a']

const BOX = new THREE.BoxGeometry(1, 1, 1)
const WHEEL = new THREE.CylinderGeometry(1, 1, 1, 14).rotateZ(Math.PI / 2)
const HEAD = new THREE.SphereGeometry(1, 12, 10)

/** 車身色由每台車的 instance color 決定 */
const paint = new THREE.MeshLambertMaterial({ color: '#ffffff' })
const glass = new THREE.MeshLambertMaterial({ color: '#1d2733' })
const rubber = new THREE.MeshLambertMaterial({ color: '#1a1a1a' })
const taillight = new THREE.MeshLambertMaterial({ color: '#b3121b', emissive: '#5a0000' })
const shirt = new THREE.MeshLambertMaterial({ color: '#4a5d6e' })
const jeans = new THREE.MeshLambertMaterial({ color: '#2c3a52' })
const helmet = new THREE.MeshLambertMaterial({ color: '#f2f2f2' })

interface Part {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  /** true 時套用每台車的車身色 */
  tint: boolean
  /** 以車子中心、地面為原點，+z 朝車頭 */
  local: THREE.Matrix4
}

function part(geometry: THREE.BufferGeometry, material: THREE.Material, [x, y, z]: number[], [w, h, l]: number[], tint = false): Part {
  return { geometry, material, tint, local: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(w, h, l)) }
}

/** 對左右兩側各放一份 */
const mirrored = (make: (side: number) => Part) => [make(-1), make(1)]

const CAR_PARTS: Part[] = [
  part(BOX, paint, [0, 0.65, 0], [1.8, 0.7, 4.4], true),
  part(BOX, glass, [0, 1.22, -0.2], [1.62, 0.45, 2.2]),
  part(BOX, paint, [0, 1.48, -0.25], [1.56, 0.08, 1.9], true),
  ...[1.4, -1.4].flatMap((z) => mirrored((side) => part(WHEEL, rubber, [side * 0.82, 0.33, z], [0.25, 0.33, 0.33]))),
  ...mirrored((side) => part(BOX, glow.headlight, [side * 0.6, 0.78, 2.2], [0.38, 0.16, 0.06])),
  ...mirrored((side) => part(BOX, taillight, [side * 0.65, 0.8, -2.2], [0.32, 0.14, 0.06])),
]

const SCOOTER_PARTS: Part[] = [
  part(BOX, paint, [0, 0.38, 0.05], [0.4, 0.22, 1.2], true),
  part(BOX, paint, [0, 0.62, -0.38], [0.42, 0.42, 0.8], true),
  part(BOX, paint, [0, 0.8, 0.58], [0.46, 0.75, 0.18], true),
  part(BOX, rubber, [0, 0.88, -0.32], [0.36, 0.1, 0.62]),
  part(BOX, rubber, [0, 1.2, 0.55], [0.62, 0.05, 0.05]),
  part(WHEEL, rubber, [0, 0.24, 0.66], [0.12, 0.24, 0.24]),
  part(WHEEL, rubber, [0, 0.24, -0.66], [0.12, 0.24, 0.24]),
  part(BOX, glow.headlight, [0, 1.02, 0.68], [0.2, 0.12, 0.05]),
  part(BOX, taillight, [0, 0.72, -0.79], [0.26, 0.1, 0.04]),
  part(BOX, jeans, [0, 1.0, 0.0], [0.42, 0.18, 0.55]),
  part(BOX, shirt, [0, 1.3, -0.25], [0.46, 0.6, 0.3]),
  part(HEAD, helmet, [0, 1.76, -0.2], [0.17, 0.17, 0.19]),
]

const PARTS: Record<VehicleKind, Part[]> = { car: CAR_PARTS, scooter: SCOOTER_PARTS }

/** 同一種車的每個零件各用一個 InstancedMesh，第 k 個 instance 是該種車的第 k 台 */
function KindMeshes({ kind }: { kind: VehicleKind }) {
  const engine = useEngine()
  const vehicles = engine.state.traffic.vehicles
  const indices = useMemo(() => vehicles.flatMap((v, i) => (v.kind === kind ? [i] : [])), [vehicles, kind])
  const parts = PARTS[kind]
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([])
  const colors = useMemo(() => {
    const palette = kind === 'car' ? CAR_COLORS : SCOOTER_COLORS
    return indices.map((i) => new THREE.Color(palette[i % palette.length]!))
  }, [indices, kind])
  const scratch = useMemo(() => ({ vehicle: new THREE.Matrix4(), world: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), one: new THREE.Vector3(1, 1, 1), up: new THREE.Vector3(0, 1, 0), pose: { pos: { x: 0, z: 0 }, heading: 0 } }), [])

  useEffect(() => {
    parts.forEach((pt, j) => {
      const mesh = meshes.current[j]
      if (!pt.tint || !mesh) return
      colors.forEach((c, k) => mesh.setColorAt(k, c))
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    })
  }, [parts, colors])

  useFrame(() => {
    const { vehicle, world, q, p, one, up, pose } = scratch
    const all = engine.state.traffic.vehicles
    indices.forEach((i, k) => {
      writeVehiclePose(engine.routes, all[i]!, pose)
      vehicle.compose(p.set(pose.pos.x, 0, pose.pos.z), q.setFromAxisAngle(up, pose.heading), one)
      parts.forEach((pt, j) => meshes.current[j]?.setMatrixAt(k, world.multiplyMatrices(vehicle, pt.local)))
    })
    meshes.current.forEach((mesh) => {
      if (mesh) mesh.instanceMatrix.needsUpdate = true
    })
  })

  return (
    <>
      {parts.map((pt, j) => (
        <instancedMesh
          key={j}
          ref={(m) => {
            meshes.current[j] = m
          }}
          args={[pt.geometry, pt.material, indices.length]}
          frustumCulled={false}
        />
      ))}
    </>
  )
}

export function TrafficCars() {
  return (
    <group>
      <KindMeshes kind="car" />
      <KindMeshes kind="scooter" />
    </group>
  )
}

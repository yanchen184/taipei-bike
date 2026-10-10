import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ROAD_WIDTH } from '../sim/city'
import { lightState, type Light } from '../sim/lights'
import type { Axis, CityMap, Intersection } from '../sim/types'
import { useEngine } from '../game/EngineContext'

const POLE_HEIGHT = 4.5
const HEAD = 0.6
const COLORS: Record<Light, THREE.Color> = {
  green: new THREE.Color('#2fe06a'),
  yellow: new THREE.Color('#ffc21a'),
  red: new THREE.Color('#ff3b30'),
}

interface Head {
  node: Intersection
  axis: Axis
  x: number
  z: number
}

/** 每個路口四角各一支燈：面向東西向來車的燈顯示東西向燈號，反之亦然 */
function signalHeads(city: CityMap): Head[] {
  const corner = ROAD_WIDTH / 2 - 0.6
  return city.intersections.flatMap((node): Head[] => [
    { node, axis: 'ew', x: node.x - corner, z: node.z + corner },
    { node, axis: 'ew', x: node.x + corner, z: node.z - corner },
    { node, axis: 'ns', x: node.x + corner, z: node.z + corner },
    { node, axis: 'ns', x: node.x - corner, z: node.z - corner },
  ])
}

const poleMaterial = new THREE.MeshLambertMaterial({ color: '#4d5257' })
const headMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' })
const BOX = new THREE.BoxGeometry(1, 1, 1)

export function Signals({ city }: { city: CityMap }) {
  const engine = useEngine()
  const heads = useMemo(() => signalHeads(city), [city])
  const poles = useRef<THREE.InstancedMesh>(null)
  const lamps = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    heads.forEach((h, k) => {
      poles.current?.setMatrixAt(k, m.compose(new THREE.Vector3(h.x, POLE_HEIGHT / 2, h.z), new THREE.Quaternion(), new THREE.Vector3(0.2, POLE_HEIGHT, 0.2)))
      lamps.current?.setMatrixAt(k, m.compose(new THREE.Vector3(h.x, POLE_HEIGHT + HEAD / 2, h.z), new THREE.Quaternion(), new THREE.Vector3(HEAD, HEAD, HEAD)))
      lamps.current?.setColorAt(k, COLORS.red)
    })
    if (poles.current) poles.current.instanceMatrix.needsUpdate = true
    if (lamps.current) lamps.current.instanceMatrix.needsUpdate = true
  }, [heads])

  useFrame(() => {
    const mesh = lamps.current
    if (!mesh) return
    const t = engine.state.t
    heads.forEach((h, k) => mesh.setColorAt(k, COLORS[lightState(h.node, h.axis, t)]))
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={poles} args={[BOX, poleMaterial, heads.length]} frustumCulled={false} />
      <instancedMesh ref={lamps} args={[BOX, headMaterial, heads.length]} frustumCulled={false} />
    </group>
  )
}

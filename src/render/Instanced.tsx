import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

/** 一個實例：底面中心位置、尺寸、繞 y 軸旋轉 */
export interface Placement {
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
  rotY?: number
  color?: string
}

const BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)

interface InstancedProps {
  items: readonly Placement[]
  material: THREE.Material | THREE.Material[]
  geometry?: THREE.BufferGeometry
}

/** 同材質的靜態物件合成一個 InstancedMesh；預設幾何是底面在 y = 0 的單位方塊 */
export function Instanced({ items, material, geometry = BOX }: InstancedProps) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const count = items.length
  const hasColor = useMemo(() => items.some((p) => p.color), [items])

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const color = new THREE.Color()
    items.forEach((p, k) => {
      q.setFromAxisAngle(up, p.rotY ?? 0)
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.sx, p.sy, p.sz))
      mesh.setMatrixAt(k, m)
      if (hasColor) mesh.setColorAt(k, color.set(p.color ?? '#ffffff'))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [items, hasColor])

  if (count === 0) return null
  return <instancedMesh key={count} ref={ref} args={[geometry, material, count]} frustumCulled={false} />
}

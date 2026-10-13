import { useFrame } from '@react-three/fiber'
import { useMemo, type RefObject } from 'react'
import * as THREE from 'three'

/** 離相機水平距離小於這個值（m）開始變透明 */
export const FADE_FAR = 4
/** 離相機水平距離小於這個值（m）時完全不畫：半透明的人貼在鏡頭前只會是一團色塊 */
export const FADE_HIDE = 1.5
/** 離相機視線（水平）超過這個值（m）就不算擋住自己，維持不透明 */
export const FADE_AXIS = 1.2

/** 依離相機的水平距離與離視線的水平距離算出不透明度；只有擋在視線上的才變透明 */
export function fadeOpacity(distance: number, offAxis = 0): number {
  if (distance < FADE_HIDE) return 0
  if (offAxis > FADE_AXIS) return 1
  return Math.min(1, (distance - FADE_HIDE) / (FADE_FAR - FADE_HIDE))
}

/** 物件擋在相機前方時畫成半透明，避免擋住自己（物件內的材質不能與其他物件共用） */
export function useNearCameraFade(ref: RefObject<THREE.Object3D | null>): void {
  const forward = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => {
    const o = ref.current
    if (!o?.visible) return
    camera.getWorldDirection(forward)
    const dx = o.position.x - camera.position.x
    const dz = o.position.z - camera.position.z
    const flat = Math.hypot(forward.x, forward.z) || 1
    const along = (dx * forward.x + dz * forward.z) / flat
    const offAxis = along > 0 ? Math.abs(dx * forward.z - dz * forward.x) / flat : Infinity
    const opacity = fadeOpacity(Math.hypot(dx, dz), offAxis)
    o.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const m = child.material as THREE.Material
      if (m.opacity === opacity) return
      m.opacity = opacity
      m.transparent = opacity < 1
      m.depthWrite = opacity === 1
      m.needsUpdate = true
    })
  })
}

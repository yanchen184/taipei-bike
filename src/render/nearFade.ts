import { useFrame } from '@react-three/fiber'
import type { RefObject } from 'react'
import * as THREE from 'three'

/** 離相機水平距離小於這個值（m）開始變透明 */
export const FADE_FAR = 4
/** 貼著相機時的不透明度 */
export const FADE_MIN = 0.25

/** 依離相機的水平距離算出不透明度 */
export function fadeOpacity(distance: number): number {
  const t = Math.min(1, Math.max(0, distance / FADE_FAR))
  return FADE_MIN + (1 - FADE_MIN) * t
}

/** 物件太靠近相機時畫成半透明，避免擋住自己（物件內的材質不能與其他物件共用） */
export function useNearCameraFade(ref: RefObject<THREE.Object3D | null>): void {
  useFrame(({ camera }) => {
    const o = ref.current
    if (!o?.visible) return
    const opacity = fadeOpacity(Math.hypot(o.position.x - camera.position.x, o.position.z - camera.position.z))
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

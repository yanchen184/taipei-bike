import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useEngine } from '../game/EngineContext'

/** 追蹤視角相機在角色／車子後方的距離與高度 */
const CHASE = {
  walk: { distance: 6, height: 3.2, look: 1.4 },
  drive: { distance: 10, height: 4.5, look: 1.2 },
  bike: { distance: 6, height: 3.2, look: 1.2 },
  indoor: { distance: 4.5, height: 4.5, look: 1 },
} as const
/** 俯視高度：看得到前後兩個路口，選手仍認得出來 */
const TOP_HEIGHT = 45
const FOLLOW = 8
const DRAG_SPEED = 0.005
/** 瞬移、進出門時相機直接跳到定位 */
const SNAP_DISTANCE = 30

/** 相機跟著玩家；滑鼠左鍵拖曳水平旋轉 */
export function CameraRig() {
  const engine = useEngine()
  const camera = useThree((s) => s.camera)
  const dom = useThree((s) => s.gl.domElement)
  const scratch = useMemo(() => ({ target: new THREE.Vector3(), look: new THREE.Vector3() }), [])

  useEffect(() => {
    let dragPointer: number | null = null
    const release = () => {
      if (dragPointer !== null && dom.hasPointerCapture(dragPointer)) dom.releasePointerCapture(dragPointer)
      dragPointer = null
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      dragPointer = e.pointerId
      dom.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId === dragPointer) engine.rotateCamera(-e.movementX * DRAG_SPEED)
    }
    const end = (e: PointerEvent) => {
      if (e.pointerId === dragPointer) release()
    }
    const events = ['pointerup', 'pointercancel', 'lostpointercapture'] as const
    dom.addEventListener('pointerdown', down)
    dom.addEventListener('pointermove', move)
    events.forEach((name) => dom.addEventListener(name, end))
    return () => {
      dom.removeEventListener('pointerdown', down)
      dom.removeEventListener('pointermove', move)
      events.forEach((name) => dom.removeEventListener(name, end))
      release()
    }
  }, [dom, engine])

  useFrame((_, delta) => {
    const s = engine.state
    const p = s.player
    const focus = p.mode === 'drive' ? p.car.pos : p.pos
    const { target, look } = scratch
    const indoors = p.location.kind === 'home'
    if (s.cameraMode === 'top' && !indoors) {
      target.set(focus.x, TOP_HEIGHT, focus.z + 0.01)
      look.set(focus.x, 0, focus.z)
    } else {
      const rig = indoors ? CHASE.indoor : CHASE[p.mode]
      target.set(focus.x - Math.sin(s.cameraYaw) * rig.distance, rig.height, focus.z - Math.cos(s.cameraYaw) * rig.distance)
      look.set(focus.x, rig.look, focus.z)
    }
    if (camera.position.distanceTo(target) > SNAP_DISTANCE) camera.position.copy(target)
    else camera.position.lerp(target, Math.min(1, delta * FOLLOW))
    camera.lookAt(look)
  })

  return null
}

import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type * as THREE from 'three'
import { useHud } from '../game/EngineContext'
import type { OnlineSession } from '../game/online'
import { useOnline, useRemotes } from '../game/OnlineContext'
import { OUTDOOR, blankNetState, canSee, writeInterpolated } from '../sim/sync'
import { BikeModel, BikeRider } from './BikeModel'
import { useNearCameraFade } from './nearFade'
import { AvatarModel, TaxiModel } from './PlayerView'

const COLORS = ['#e8554e', '#3fb950', '#a371f7', '#f0883e', '#39c5cf'] as const

interface RemotePlayerProps {
  online: OnlineSession
  uid: string
  name: string
  color: string
  labelRoot: RefObject<HTMLElement>
}

function RemotePlayer({ online, uid, name, color, labelRoot }: RemotePlayerProps) {
  const car = useRef<THREE.Group>(null)
  const avatar = useRef<THREE.Group>(null)
  const bike = useRef<THREE.Group>(null)
  const label = useRef<THREE.Group>(null)
  const [shown] = useState(blankNetState)

  useEffect(() => {
    online.store.rendered.set(uid, shown)
    return () => {
      online.store.rendered.delete(uid)
    }
  }, [online, uid, shown])

  useFrame(() => {
    if (!writeInterpolated(online.store.samplesOf(uid), performance.now(), shown)) return
    const walking = shown.mode === 'walk'
    if (car.current) {
      car.current.visible = shown.loc === OUTDOOR
      car.current.position.set(shown.cx, 0, shown.cz)
      car.current.rotation.y = shown.ch
    }
    if (avatar.current) {
      avatar.current.visible = walking
      avatar.current.position.set(shown.x, 0, shown.z)
      avatar.current.rotation.y = shown.h
    }
    if (bike.current) {
      bike.current.visible = shown.mode === 'bike'
      bike.current.position.set(shown.x, 0, shown.z)
      bike.current.rotation.y = shown.h
    }
    if (label.current) {
      if (shown.mode !== 'drive') label.current.position.set(shown.x, 2.4, shown.z)
      else label.current.position.set(shown.cx, 2.6, shown.cz)
    }
  })
  useNearCameraFade(bike)

  return (
    <group name={`remote-${uid}`}>
      <group ref={car}>
        <TaxiModel />
      </group>
      <group ref={avatar}>
        <AvatarModel color={color} />
      </group>
      <group ref={bike} name={`remote-bike-${uid}`} visible={false}>
        <BikeModel color={color} />
        <BikeRider color={color} />
      </group>
      <group ref={label}>
        <Html center portal={labelRoot}>
          <div data-testid="remote-name" className="pointer-events-none whitespace-nowrap rounded bg-black/60 px-2 py-0.5 text-sm text-white">
            {name}
          </div>
        </Html>
      </group>
    </group>
  )
}

/** 同一個地點（戶外或同一戶）的其他玩家 */
export function RemotePlayers() {
  const online = useOnline()
  const remotes = useRemotes(online)
  const { homeId } = useHud()
  const gl = useThree((s) => s.gl)
  // 不指定 portal 時，drei 在畫布事件連上後會把標籤改掛到另一個元素並重建 React root
  const labelRoot = useMemo(() => ({ current: gl.domElement.parentElement! }), [gl])
  if (!online) return null
  const here = homeId ?? OUTDOOR
  return (
    <>
      {remotes.map((r, k) =>
        canSee(here, r.loc) ? <RemotePlayer key={r.uid} online={online} uid={r.uid} name={r.name} color={COLORS[k % COLORS.length]!} labelRoot={labelRoot} /> : null,
      )}
    </>
  )
}

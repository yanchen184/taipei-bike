import { useMemo } from 'react'
import * as THREE from 'three'
import type { Prop } from '../../sim/types'
import { Instanced, type Placement } from '../Instanced'
import { glow } from '../materials'

const LAMP_HEIGHT = 6
const LAMP_HEAD = 0.5

const trunk = new THREE.MeshLambertMaterial({ color: '#6b4a2f' })
const leaves = new THREE.MeshLambertMaterial({ color: '#3f7d3a' })
const wood = new THREE.MeshLambertMaterial({ color: '#9a6b3f' })
const slideMaterial = new THREE.MeshLambertMaterial({ color: '#e0533d' })
const pole = new THREE.MeshLambertMaterial({ color: '#5c6166' })

const CYLINDER = new THREE.CylinderGeometry(0.5, 0.5, 1, 8).translate(0, 0.5, 0)
const CROWN = new THREE.SphereGeometry(0.5, 10, 8).translate(0, 0.5, 0)

function size(p: Prop): { w: number; d: number } {
  const r = p.rect
  return r ? { w: r.maxX - r.minX, d: r.maxZ - r.minZ } : { w: 0.3, d: 0.3 }
}

interface PropLayout {
  trunks: Placement[]
  crowns: Placement[]
  benches: Placement[]
  slides: Placement[]
  poles: Placement[]
  heads: Placement[]
}

function layoutProps(props: readonly Prop[]): PropLayout {
  const out: PropLayout = { trunks: [], crowns: [], benches: [], slides: [], poles: [], heads: [] }
  for (const p of props) {
    const { x, z } = p.pos
    const { w, d } = size(p)
    switch (p.kind) {
      case 'tree':
        out.trunks.push({ x, y: 0, z, sx: 0.4, sy: 2.4, sz: 0.4 })
        out.crowns.push({ x, y: 1.8, z, sx: 3, sy: 3.2, sz: 3 })
        break
      case 'bench':
        out.benches.push({ x, y: 0, z, sx: w, sy: 0.5, sz: d })
        break
      case 'slide':
        out.slides.push({ x, y: 0, z, sx: w, sy: 2, sz: d })
        break
      case 'lamp':
        out.poles.push({ x, y: 0, z, sx: 0.18, sy: LAMP_HEIGHT, sz: 0.18 })
        out.heads.push({ x, y: LAMP_HEIGHT, z, sx: LAMP_HEAD, sy: 0.25, sz: LAMP_HEAD })
        break
    }
  }
  return out
}

export function Props({ props }: { props: readonly Prop[] }) {
  const layout = useMemo(() => layoutProps(props), [props])
  return (
    <group>
      <Instanced items={layout.trunks} material={trunk} geometry={CYLINDER} />
      <Instanced items={layout.crowns} material={leaves} geometry={CROWN} />
      <Instanced items={layout.benches} material={wood} />
      <Instanced items={layout.slides} material={slideMaterial} />
      <Instanced items={layout.poles} material={pole} geometry={CYLINDER} />
      <Instanced items={layout.heads} material={glow.lampHead} />
    </group>
  )
}

import * as THREE from 'three'

export interface SceneSurfaces {
  /** 可見 mesh 綁定的貼圖名稱（TextureName） */
  maps: string[]
  /** 可見 mesh 上 emissiveIntensity > 0 的具名材質 */
  glowing: string[]
}

type ProbedMaterial = THREE.Material & { map?: THREE.Texture | null; emissiveIntensity?: number }

/** 走訪場景中可見的 mesh，列出實際畫出來的貼圖與發光材質 */
export function sceneSurfaces(scene: THREE.Object3D): SceneSurfaces {
  const maps = new Set<string>()
  const glowing = new Set<string>()
  scene.traverseVisible((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const materials: ProbedMaterial[] = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of materials) {
      if (m.map?.name) maps.add(m.map.name)
      if (m.name && (m.emissiveIntensity ?? 0) > 0) glowing.add(m.name)
    }
  })
  return { maps: [...maps].sort(), glowing: [...glowing].sort() }
}

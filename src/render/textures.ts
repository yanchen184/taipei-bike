import * as THREE from 'three'
import asphaltUrl from '../assets/textures/asphalt.jpg'
import facadeAcUrl from '../assets/textures/facade-apartment-ac.jpg'
import facadeUrl from '../assets/textures/facade-apartment.jpg'
import grassUrl from '../assets/textures/grass.jpg'
import interiorFloorUrl from '../assets/textures/interior-floor.jpg'
import interiorWallUrl from '../assets/textures/interior-wall.jpg'
import roofUrl from '../assets/textures/roof-concrete.jpg'
import shopfrontUrl from '../assets/textures/shopfront.jpg'
import sidewalkUrl from '../assets/textures/sidewalk-tile.jpg'
import towerGlassUrl from '../assets/textures/tower-glass.jpg'

/** docs/art/brief.md 的貼圖清單 */
export const TEXTURE_URLS = {
  asphalt: asphaltUrl,
  facade: facadeUrl,
  facadeAc: facadeAcUrl,
  grass: grassUrl,
  interiorFloor: interiorFloorUrl,
  interiorWall: interiorWallUrl,
  roof: roofUrl,
  shopfront: shopfrontUrl,
  sidewalk: sidewalkUrl,
  towerGlass: towerGlassUrl,
} as const

export type TextureName = keyof typeof TEXTURE_URLS

/** brief「立面窗位」：一層樓圖塊 768×384，第 k 扇窗玻璃 x ∈ [k·256+28, k·256+228]、y ∈ [56, 296] */
export const FACADE_TILE = { width: 768, height: 384, cell: 256, glassX0: 28, glassX1: 228, glassY0: 56, glassY1: 296 } as const

export interface GlassRect {
  x: number
  y: number
  width: number
  height: number
}

/** 立面圖塊縮放到 tileWidth × tileHeight 後三扇窗的玻璃矩形 */
export function facadeGlassRects(tileWidth: number, tileHeight: number): GlassRect[] {
  const sx = tileWidth / FACADE_TILE.width
  const sy = tileHeight / FACADE_TILE.height
  return [0, 1, 2].map((k) => ({
    x: (k * FACADE_TILE.cell + FACADE_TILE.glassX0) * sx,
    y: FACADE_TILE.glassY0 * sy,
    width: (FACADE_TILE.glassX1 - FACADE_TILE.glassX0) * sx,
    height: (FACADE_TILE.glassY1 - FACADE_TILE.glassY0) * sy,
  }))
}

const sources = new Map<TextureName, THREE.Texture>()
let loading: Promise<void> | null = null

/** 載入全部貼圖；重複呼叫回傳同一個 Promise */
export function loadTextures(): Promise<void> {
  loading ??= (async () => {
    const loader = new THREE.TextureLoader()
    const entries = Object.entries(TEXTURE_URLS) as [TextureName, string][]
    const loaded = await Promise.all(entries.map(async ([name, url]) => [name, await loader.loadAsync(url)] as const))
    for (const [name, tex] of loaded) {
      tex.name = name
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.anisotropy = 8
      sources.set(name, tex)
    }
  })()
  return loading
}

/** 共用同一份圖片來源、各自設定重複次數的貼圖；須在 loadTextures 完成後呼叫 */
export function tiled(name: TextureName, repeatX: number, repeatY: number): THREE.Texture {
  const source = sources.get(name)
  if (!source) throw new Error(`texture ${name} not loaded`)
  const tex = source.clone()
  tex.repeat.set(repeatX, repeatY)
  return tex
}

/** 測試掛鉤：每張貼圖的實際尺寸；未載入時為 0 */
export function textureStatus(): { name: TextureName; width: number; height: number }[] {
  return (Object.keys(TEXTURE_URLS) as TextureName[]).map((name) => {
    const image = sources.get(name)?.image as HTMLImageElement | undefined
    return { name, width: image?.naturalWidth ?? 0, height: image?.naturalHeight ?? 0 }
  })
}

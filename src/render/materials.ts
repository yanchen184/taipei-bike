import * as THREE from 'three'
import { createRng } from '../sim/rng'
import { facadeGlassRects, tiled } from './textures'

const FLOOR_PX = 64
const FACADE_PX = 128
/** 每種樓層數做幾種亮燈分布；偶數用 facade、奇數用 facadeAc 圖塊 */
export const FACADE_VARIANTS = 3

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const el = document.createElement('canvas')
  el.width = width
  el.height = height
  const ctx = el.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  return [el, ctx]
}

function texture(el: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(el)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** 夜間亮窗遮罩：黑底，亮著的窗依 brief「立面窗位」畫成暖光或冷光 */
function windowGlowTexture(floors: number, variant: number): THREE.CanvasTexture {
  const height = FLOOR_PX * floors
  const [el, g] = canvas(FACADE_PX, height)
  const rng = createRng(floors * 31 + variant)
  g.fillStyle = '#000000'
  g.fillRect(0, 0, FACADE_PX, height)
  const glass = facadeGlassRects(FACADE_PX, FLOOR_PX)
  for (let f = 0; f < floors; f++) {
    for (const w of glass) {
      if (!rng.chance(0.55)) continue
      g.fillStyle = rng.chance(0.7) ? '#ffd27a' : '#cfe6ff'
      g.fillRect(w.x, f * FLOOR_PX + w.y, w.width, w.height)
    }
  }
  return texture(el)
}

/** 夜間各類發光材質的 emissiveIntensity；白天全為 0 */
const NIGHT_LEVEL = { windows: 1, lamps: 1.2, headlights: 1.5, signs: 0.8 } as const
let night = false

function level(kind: keyof typeof NIGHT_LEVEL): number {
  return night ? NIGHT_LEVEL[kind] : 0
}

let roofMaterial: THREE.MeshLambertMaterial | null = null
const facadeCache = new Map<string, THREE.Material[]>()

/** 樓層外觀的材質陣列（BoxGeometry 的六面：+x −x +y −y +z −z），夜間亮度由 setNightGlow 控制 */
export function facadeMaterials(floors: number, variant: number): THREE.Material[] {
  const key = `${floors}-${variant}`
  const cached = facadeCache.get(key)
  if (cached) return cached
  const map = tiled(variant % 2 === 0 ? 'facade' : 'facadeAc', 1, floors)
  const emissiveMap = windowGlowTexture(floors, variant)
  const wall = new THREE.MeshLambertMaterial({
    name: 'facadeWall',
    map,
    emissiveMap,
    emissive: '#ffffff',
    emissiveIntensity: level('windows'),
  })
  roofMaterial ??= new THREE.MeshLambertMaterial({ map: tiled('roof', 2, 2) })
  const materials = [wall, wall, roofMaterial, roofMaterial, wall, wall]
  facadeCache.set(key, materials)
  return materials
}

/** 直立招牌：紅底白字或白底紅字，直書 */
export function signTexture(text: string, variant: number): THREE.CanvasTexture {
  const chars = [...text]
  const [el, ctx] = canvas(64, 64 * chars.length + 16)
  const palettes = [
    ['#c8202f', '#ffffff'],
    ['#ffffff', '#c8202f'],
    ['#1d5fae', '#ffffff'],
    ['#f2c230', '#5a2a00'],
  ] as const
  const [bg, fg] = palettes[variant % palettes.length]!
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, el.width, el.height)
  ctx.fillStyle = fg
  ctx.font = 'bold 50px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  chars.forEach((c, k) => ctx.fillText(c, 32, 8 + 64 * k + 34))
  return texture(el)
}

/** 橫式字牌：路名牌、地標立牌、捷運站名；寬度依字數 */
export function plateTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const chars = [...text]
  const [el, ctx] = canvas(56 * chars.length + 32, 80)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, el.width, el.height)
  ctx.strokeStyle = fg
  ctx.lineWidth = 4
  ctx.strokeRect(6, 6, el.width - 12, el.height - 12)
  ctx.fillStyle = fg
  ctx.font = 'bold 48px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, el.width / 2, 42)
  return texture(el)
}

/** 名牌（其他玩家頭上的暱稱） */
export function labelTexture(text: string): THREE.CanvasTexture {
  const [el, ctx] = canvas(256, 64)
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.beginPath()
  ctx.roundRect(4, 8, 248, 48, 20)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 30px "Noto Sans TC", "Microsoft JhengHei", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 33)
  return texture(el)
}

/** 夜間會發光的共用材質 */
export const glow = {
  lampHead: new THREE.MeshLambertMaterial({ name: 'lampHead', color: '#f4f1e6', emissive: '#ffe2a0', emissiveIntensity: 0 }),
  headlight: new THREE.MeshLambertMaterial({ color: '#f7f7f0', emissive: '#fff4cc', emissiveIntensity: 0 }),
  sign: [] as THREE.MeshLambertMaterial[],
}

/** 登記招牌材質到夜間發光清單，並套用目前的日夜 */
export function registerSign(material: THREE.MeshLambertMaterial): void {
  material.emissiveIntensity = level('signs')
  glow.sign.push(material)
}

/** 套用日夜：窗戶、路燈、車頭燈、招牌一起切換；之後才建立的立面與招牌材質也沿用此狀態 */
export function setNightGlow(on: boolean): void {
  night = on
  for (const materials of facadeCache.values()) {
    const wall = materials[0] as THREE.MeshLambertMaterial
    wall.emissiveIntensity = level('windows')
  }
  glow.lampHead.emissiveIntensity = level('lamps')
  glow.headlight.emissiveIntensity = level('headlights')
  for (const m of glow.sign) m.emissiveIntensity = level('signs')
}

/** 測試掛鉤讀實際材質的發光強度 */
export function readNightGlow(): { windows: number; lamps: number; headlights: number } {
  const first = facadeCache.values().next().value
  return {
    windows: first ? (first[0] as THREE.MeshLambertMaterial).emissiveIntensity : 0,
    lamps: glow.lampHead.emissiveIntensity,
    headlights: glow.headlight.emissiveIntensity,
  }
}

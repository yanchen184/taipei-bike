// @vitest-environment jsdom
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./textures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./textures')>()),
  tiled: () => new THREE.Texture(),
}))

const { facadeMaterials, readNightGlow, registerSign, setNightGlow } = await import('./materials')
const { facadeGlassRects } = await import('./textures')

interface Fill {
  x: number
  y: number
  width: number
  height: number
  style: string
}

describe('夜間發光與材質建立順序', () => {
  let fills: Fill[]

  beforeEach(() => {
    fills = []
    const ctx = {
      fillStyle: '',
      fillRect(x: number, y: number, width: number, height: number) {
        fills.push({ x, y, width, height, style: this.fillStyle })
      },
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  })

  afterEach(() => {
    setNightGlow(false)
    vi.restoreAllMocks()
  })

  test('[C3-2] 先入夜、後建立的立面與招牌材質也會亮', () => {
    setNightGlow(true)
    const wall = facadeMaterials(5, 1)[0] as THREE.MeshLambertMaterial
    expect(wall.emissiveIntensity).toBeGreaterThan(0)
    expect(readNightGlow().windows).toBeGreaterThan(0)

    const sign = new THREE.MeshLambertMaterial()
    registerSign(sign)
    expect(sign.emissiveIntensity).toBeGreaterThan(0)

    setNightGlow(false)
    expect(wall.emissiveIntensity).toBe(0)
    expect(sign.emissiveIntensity).toBe(0)
  })

  test('[V1-2] 亮窗遮罩只在 brief 窗位內畫亮區', () => {
    const floors = 6
    facadeMaterials(floors, 2)
    const [background, ...lit] = fills
    expect(background).toMatchObject({ x: 0, y: 0, style: '#000000' })
    expect(lit.length).toBeGreaterThan(0)
    const glass = facadeGlassRects(background!.width, background!.height / floors)
    const floorHeight = background!.height / floors
    for (const r of lit) {
      const floor = Math.floor(r.y / floorHeight)
      expect(glass.map((g) => ({ ...g, y: g.y + floor * floorHeight }))).toContainEqual({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      })
    }
  })
})

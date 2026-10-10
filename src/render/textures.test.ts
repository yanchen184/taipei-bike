import { describe, expect, test } from 'vitest'
import brief from '../../docs/art/brief.md?raw'
import { FACADE_TILE, TEXTURE_URLS, facadeGlassRects } from './textures'

const MAX_TOTAL_BYTES = 1024 * 1024
/** 檔名 → base64 data URL */
const files = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../assets/textures/*.jpg', { eager: true, query: '?inline', import: 'default' })).map(
    ([path, url]) => [path.split('/').pop()!, url],
  ),
)

/** brief 清單表格的每一列：`檔名` | 寬×高 */
function briefList(): { file: string; width: number; height: number }[] {
  return [...brief.matchAll(/^\| `([\w-]+\.jpg)` \| (\d+)×(\d+) \|/gm)].map((m) => ({
    file: m[1]!,
    width: Number(m[2]),
    height: Number(m[3]),
  }))
}

function bytes(dataUrl: string): Uint8Array {
  return Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))
}

/** JPEG 第一個 SOF 區段（基線或漸進式）的寬高 */
function jpegSize(data: Uint8Array): { width: number; height: number } {
  const view = new DataView(data.buffer)
  expect(view.getUint16(0)).toBe(0xffd8)
  let offset = 2
  while (offset < data.length) {
    const marker = view.getUint16(offset)
    if (marker === 0xffc0 || marker === 0xffc2) return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) }
    offset += 2 + view.getUint16(offset + 2)
  }
  throw new Error('JPEG 沒有 SOF 區段')
}

describe('寫實貼圖', () => {
  test('[V1-3] 貼圖檔的檔名與尺寸符合 brief，總大小不超過 1 MB', () => {
    const list = briefList()
    expect(list).toHaveLength(Object.keys(TEXTURE_URLS).length)
    let total = 0
    for (const { file, width, height } of list) {
      const url = files[file]
      expect(url, file).toBeDefined()
      const data = bytes(url!)
      expect(jpegSize(data), file).toEqual({ width, height })
      total += data.length
    }
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
  })

  test('[V1-2] 亮窗遮罩的玻璃矩形與 brief「立面窗位」一致', () => {
    expect(facadeGlassRects(FACADE_TILE.width, FACADE_TILE.height)).toEqual([
      { x: 28, y: 56, width: 200, height: 240 },
      { x: 284, y: 56, width: 200, height: 240 },
      { x: 540, y: 56, width: 200, height: 240 },
    ])
    expect(brief).toContain('x 從 `k×256 + 28` 到 `k×256 + 228`，y 從 56 到 296')
    const scaled = facadeGlassRects(128, 64)
    expect(scaled[1]).toEqual({
      x: expect.closeTo(284 / 6),
      y: expect.closeTo(56 / 6),
      width: expect.closeTo(200 / 6),
      height: expect.closeTo(240 / 6),
    })
  })
})

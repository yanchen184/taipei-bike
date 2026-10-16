import { describe, expect, test } from 'vitest'
import {
  BASE_STATS,
  BUDGET,
  DEFAULT_BUILD,
  LEGAL_BUILDS,
  PARTS,
  SLOTS,
  bikeSpec,
  buildLabel,
  buildPrice,
  buildStats,
  isValidBuild,
  partsFor,
  swapPart,
  type Build,
} from './parts'

const CHEAPEST: Build = { frame: 'steel', wheel: 'commuter', drive: 'single', bar: 'flat' }

describe('W1 整備站', () => {
  test('[W1-2] 每個部位只能選一款，總價超過 1000 元的組合不能選，剩餘預算即時更新', () => {
    expect(BUDGET).toBe(1000)
    expect(SLOTS.map((slot) => partsFor(slot).length)).toEqual([3, 3, 3, 3])
    expect(buildPrice(CHEAPEST)).toBe(400)
    expect(buildPrice(DEFAULT_BUILD)).toBe(900)

    const carbon = swapPart(CHEAPEST, 'frame', 'carbon')!
    expect(carbon).toEqual({ ...CHEAPEST, frame: 'carbon' })
    expect(BUDGET - buildPrice(carbon)).toBe(200)
    expect(swapPart(carbon, 'wheel', 'slick')).toEqual({ ...carbon, wheel: 'slick' })
    expect(swapPart(swapPart(carbon, 'wheel', 'slick')!, 'drive', 'tall')).toBeNull()

    expect(isValidBuild({ ...CHEAPEST, frame: 'slick' })).toBe(false)
    expect(isValidBuild({ ...CHEAPEST, extra: 'flat' })).toBe(false)
    expect(isValidBuild({ frame: 'steel', wheel: 'commuter', drive: 'single' })).toBe(false)
    expect(isValidBuild({ frame: 'carbon', wheel: 'grip', drive: 'tall', bar: 'stem' })).toBe(false)
    expect(isValidBuild(null)).toBe(false)

    const strongest = SLOTS.reduce((sum, slot) => sum + Math.max(...partsFor(slot).map((p) => p.price)), 0)
    expect(strongest).toBeGreaterThan(BUDGET)
    expect(LEGAL_BUILDS.every((b) => isValidBuild(b))).toBe(true)
    expect(new Set(LEGAL_BUILDS.map((b) => JSON.stringify(b))).size).toBe(LEGAL_BUILDS.length)
  })
})

describe('W2 組裝性能', () => {
  test('[W2-1] 組裝的四項性能等於基準加上四個零件的效果', () => {
    expect(BASE_STATS).toEqual({ top: 12, accel: 3, corner: 6, brake: 5 })
    expect(buildStats(CHEAPEST)).toEqual(BASE_STATS)
    expect(buildStats(DEFAULT_BUILD)).toEqual({ top: 11.5, accel: 5, corner: 10, brake: 5 })
    expect(buildStats({ frame: 'carbon', wheel: 'slick', drive: 'single', bar: 'flat' })).toEqual({ top: 16, accel: 3.5, corner: 5, brake: 5 })
    expect(buildStats({ frame: 'steel', wheel: 'grip', drive: 'tall', bar: 'drop' })).toEqual({ top: 15, accel: 2, corner: 8, brake: 8 })

    const spec = bikeSpec(DEFAULT_BUILD)
    expect([spec.maxSpeed, spec.accel, spec.corner, spec.brake]).toEqual([11.5, 5, 10, 5])
    expect(buildLabel(DEFAULT_BUILD)).toBe('鋁合金＋通勤輪＋輕齒比＋短龍頭')
    expect(PARTS.every((p) => p.price > 0)).toBe(true)
  })
})

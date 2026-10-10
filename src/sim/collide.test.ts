import { describe, expect, test } from 'vitest'
import { rect, segmentHitsRect } from './collide'

describe('segmentHitsRect', () => {
  const wall = rect(0, 4.9, 6, 5.1)

  test('線段穿過矩形時為 true', () => {
    expect(segmentHitsRect({ x: 3, z: 8 }, { x: 3, z: 2 }, wall)).toBe(true)
    expect(segmentHitsRect({ x: -2, z: 8 }, { x: 4, z: 2 }, wall)).toBe(true)
  })

  test('線段沒碰到矩形時為 false', () => {
    expect(segmentHitsRect({ x: 3, z: 8 }, { x: 3, z: 6 }, wall)).toBe(false)
    expect(segmentHitsRect({ x: 7, z: 8 }, { x: 7, z: 2 }, wall)).toBe(false)
    expect(segmentHitsRect({ x: -5, z: 8 }, { x: -1, z: 2 }, wall)).toBe(false)
  })

  test('端點在矩形內或線段與矩形邊平行時正確判斷', () => {
    expect(segmentHitsRect({ x: 3, z: 5 }, { x: 3, z: 9 }, wall)).toBe(true)
    expect(segmentHitsRect({ x: -1, z: 5 }, { x: 8, z: 5 }, wall)).toBe(true)
    expect(segmentHitsRect({ x: -1, z: 6 }, { x: 8, z: 6 }, wall)).toBe(false)
  })
})

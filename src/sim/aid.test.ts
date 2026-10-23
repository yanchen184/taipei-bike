import { describe, expect, test } from 'vitest'
import {
  CATCHUP_FROM,
  CATCHUP_FULL,
  CATCHUP_SAVE,
  CATCHUP_SPEED,
  DRAFT_FULL,
  DRAFT_RANGE,
  DRAFT_SAVE,
  DRAFT_SPEED,
  DRAFT_WIDTH,
  NO_AID,
  catchupStrength,
  draftStrength,
  makeAid,
  routeProgress,
} from './aid'
import { restingBike, stepBike, type BikeState } from './bike'
import type { Course } from './course'
import { BIKE_SPEC } from './vehicle'

/** 往 +z 騎、速度 8 的選手 */
const SELF = { pos: { x: 0, z: 0 }, heading: 0, speed: 8 }

describe('B4 破風與後追', () => {
  test('[B4-1] 正後方 3 m 內破風全滿，到 10 m 線性降到 0；偏離車頭方向超過 1.5 m、在後面或太慢都沒有', () => {
    expect(draftStrength(SELF, [{ x: 0, z: DRAFT_FULL }])).toBe(1)
    expect(draftStrength(SELF, [{ x: 0, z: 1 }])).toBe(1)
    expect(draftStrength(SELF, [{ x: 0, z: (DRAFT_FULL + DRAFT_RANGE) / 2 }])).toBeCloseTo(0.5)
    expect(draftStrength(SELF, [{ x: 0, z: DRAFT_RANGE + 0.1 }])).toBe(0)
    expect(draftStrength(SELF, [{ x: DRAFT_WIDTH + 0.1, z: 2 }])).toBe(0)
    expect(draftStrength(SELF, [{ x: 0, z: -2 }])).toBe(0)
    expect(draftStrength({ ...SELF, speed: 3 }, [{ x: 0, z: 2 }])).toBe(0)
  })

  test('[B4-1] 依自己的車頭方向判斷前後，有多位前車時取最強的', () => {
    const east = { ...SELF, heading: Math.PI / 2 }
    expect(draftStrength(east, [{ x: 2, z: 0 }])).toBe(1)
    expect(draftStrength(east, [{ x: 0, z: 2 }])).toBe(0)
    expect(draftStrength(SELF, [{ x: 0, z: 9 }, { x: 0, z: 2 }])).toBe(1)
  })

  test('[B4-2] 落後領先者 40 m 內沒有後追，到 200 m 線性加滿', () => {
    expect(catchupStrength(0)).toBe(0)
    expect(catchupStrength(CATCHUP_FROM)).toBe(0)
    expect(catchupStrength((CATCHUP_FROM + CATCHUP_FULL) / 2)).toBeCloseTo(0.5)
    expect(catchupStrength(CATCHUP_FULL)).toBe(1)
    expect(catchupStrength(1000)).toBe(1)
  })

  test('[B4-3] 加成：破風全滿極速 +8%、消耗 −50%；後追全滿極速 +12%、消耗 −40%；兩者疊加', () => {
    expect(makeAid(0, 0)).toBe(NO_AID)
    expect(makeAid(1, 0)).toMatchObject({ speed: 1 + DRAFT_SPEED, drain: 1 - DRAFT_SAVE })
    expect(makeAid(0, 1)).toMatchObject({ speed: 1 + CATCHUP_SPEED, drain: 1 - CATCHUP_SAVE })
    const both = makeAid(1, 1)
    expect(both.speed).toBeCloseTo(1 + DRAFT_SPEED + CATCHUP_SPEED)
    expect(both.drain).toBeCloseTo((1 - DRAFT_SAVE) * (1 - CATCHUP_SAVE))
  })

  test('[B4-3] 有加成時一直踩：極速比組裝高、體力耗得比較慢', () => {
    const DT = 1 / 120
    const ride = (aid = NO_AID, seconds = 6) => {
      let b: BikeState = restingBike({ pos: { x: 0, z: 0 }, heading: 0 })
      for (let k = 0; k < seconds / DT; k++) b = stepBike(b, BIKE_SPEC, { forward: 1, right: 0, handbrake: false }, DT, [], [], aid)
      return b
    }
    const plain = ride()
    const aided = ride(makeAid(1, 1))
    expect(plain.speed).toBeLessThanOrEqual(BIKE_SPEC.maxSpeed + 1e-9)
    expect(aided.speed).toBeGreaterThan(BIKE_SPEC.maxSpeed)
    expect(aided.stamina.level).toBeGreaterThan(plain.stamina.level)
  })

  test('[B4-4] 沿路線的進度：投影到目前檢查點之間的路段，越往前越大；完成時為全長', () => {
    const course: Course = {
      n: 1,
      nodes: [
        { x: 0, z: 0 },
        { x: 0, z: 100 },
        { x: 100, z: 100 },
        { x: 100, z: 0 },
        { x: 200, z: 0 },
      ],
      checkpoints: [2, 4],
      grid: [],
    }
    expect(routeProgress(course, 0, { x: 1, z: 50 })).toBeCloseTo(50)
    expect(routeProgress(course, 0, { x: 40, z: 99 })).toBeCloseTo(140)
    expect(routeProgress(course, 1, { x: 99, z: 30 })).toBeCloseTo(270)
    expect(routeProgress(course, 1, { x: 150, z: 2 })).toBeCloseTo(350)
    expect(routeProgress(course, 2, { x: 0, z: 0 })).toBe(400)
  })
})

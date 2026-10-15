import { describe, expect, test } from 'vitest'
import { AI_STEP, aiDriver, createAi, stepAi } from './ai'
import { aiBuild } from './balance'
import { generateCity } from './city'
import { generateCourse, type Course } from './course'
import { BUDGET, DEFAULT_BUILD, LEGAL_BUILDS, buildPrice, buildStats, isValidBuild, type Build } from './parts'
import { RACE_LIMIT_MS } from './race'
import type { CityMap } from './types'

const AI_1 = 0
const AI_5 = 4
const CASES = [
  [3, 1],
  [42, 2],
  [2024, 3],
  [7, 4],
  [1, 1],
  [9, 3],
] as const

/** 第 k 台 AI 用 build 單獨騎完賽道（沒有交通）的秒數 */
function soloTime(city: CityMap, course: Course, k: number, build: Build): number {
  const driver = aiDriver(k, build)
  let ai = createAi(course, 0)
  for (let step = 1; step <= (RACE_LIMIT_MS / 1000) / AI_STEP; step++) {
    ai = stepAi(ai, driver, course, AI_STEP, city.colliders, [])
    if (ai.fin) return step * AI_STEP
  }
  return Infinity
}

interface Field {
  city: CityMap
  course: Course
  /** 所有合法組裝用 AI 5 的騎法模擬，由快到慢 */
  ranked: Build[]
}

let fields: Field[] | null = null

/** 每條測試賽道上所有合法組裝的模擬排名，算一次給 W5 與 A2-2 共用 */
function simulatedFields(): Field[] {
  fields ??= CASES.map(([seed, n]) => {
    const city = generateCity(seed)
    const course = generateCourse(city, n)
    const ranked = LEGAL_BUILDS.map((build) => ({ build, time: soloTime(city, course, AI_5, build) }))
      .sort((a, b) => a.time - b.time)
      .map((r) => r.build)
    return { city, course, ranked }
  })
  return fields
}

describe('W5 平衡', () => {
  test('[W5-1] 同一套騎法在多個 seed 的賽道上，沒有任何一套組裝在所有賽道都最快', () => {
    const winners = new Set(simulatedFields().map((f) => JSON.stringify(f.ranked[0])))
    expect(winners.size).toBeGreaterThanOrEqual(2)
  }, 120_000)

  test('[W5-2] 不同賽道的最快組裝至少有重極速與重過彎兩種取向', () => {
    const stats = simulatedFields().map((f) => buildStats(f.ranked[0]!))
    const tradeOff = stats.some((a) => stats.some((b) => a.top > b.top && a.corner < b.corner))
    expect(tradeOff).toBe(true)
  }, 120_000)
})

describe('A2 AI 配車與騎法', () => {
  test('[A2-1] 給定 seed 與局數，每台 AI 的組裝完全確定且不超過預算', () => {
    for (const [seed, n] of CASES) {
      const course = generateCourse(generateCity(seed), n)
      const again = generateCourse(generateCity(seed), n)
      for (let k = AI_1; k <= AI_5; k++) {
        const build = aiBuild(course, seed, k)
        expect(aiBuild(again, seed, k)).toEqual(build)
        expect(isValidBuild(build)).toBe(true)
        expect(buildPrice(build)).toBeLessThanOrEqual(BUDGET)
      }
    }
  })

  test('[A2-2] AI 5 挑的組裝在本局賽道的模擬成績排在所有合法組裝的前 10%', () => {
    for (const { city, course, ranked } of simulatedFields()) {
      const rank = ranked.findIndex((b) => JSON.stringify(b) === JSON.stringify(aiBuild(course, city.seed, AI_5)))
      expect(rank, `seed ${city.seed} 局 ${course.n}`).toBeLessThan(LEGAL_BUILDS.length * 0.1)
    }
  }, 120_000)

  test('[A2-3] 同一套組裝下，AI 1 到 AI 5 騎完同一條賽道的時間遞減', () => {
    for (const [seed, n] of CASES.slice(0, 3)) {
      const city = generateCity(seed)
      const course = generateCourse(city, n)
      const times = [0, 1, 2, 3, 4].map((k) => soloTime(city, course, k, DEFAULT_BUILD))
      for (let k = 1; k < times.length; k++) expect(times[k], `seed ${seed} AI ${k + 1}`).toBeLessThan(times[k - 1]!)
    }
  }, 60_000)

  test('[A2-4] AI 5 單獨騎完賽道的時間不超過 AI 1 的 85%', () => {
    for (const [seed, n] of CASES) {
      const city = generateCity(seed)
      const course = generateCourse(city, n)
      const weakest = soloTime(city, course, AI_1, aiBuild(course, seed, AI_1))
      const strongest = soloTime(city, course, AI_5, aiBuild(course, seed, AI_5))
      expect(strongest, `seed ${seed} 局 ${n}`).toBeLessThanOrEqual(weakest * 0.85)
    }
  }, 60_000)
})

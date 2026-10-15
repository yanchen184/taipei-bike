import { describe, expect, test } from 'vitest'
import {
  COUNTDOWN_MS,
  PREP_MS,
  FINISH_GRACE_MS,
  RACE_LIMIT_MS,
  aiLimit,
  aiName,
  goTime,
  prepEnd,
  firstFinish,
  raceOver,
  racePhase,
  rankRacers,
  type RaceMeta,
  type Standing,
} from './race'

const meta: RaceMeta = { n: 1, ai: 2, cps: 6, at: 1_000_000, entrants: { u1: 0, u2: 1 } }
const GO = meta.at + PREP_MS + COUNTDOWN_MS

describe('G3 名次', () => {
  test('[G3-2] 完成者依完成時間，未完成者依檢查點數、再依離下一檢查點的距離', () => {
    const standings: Standing[] = [
      { id: 'a', cp: 3, dist: 50 },
      { id: 'b', cp: 6, fin: GO + 90_000, dist: 0 },
      { id: 'c', cp: 3, dist: 20 },
      { id: 'd', cp: 5, dist: 300 },
      { id: 'e', cp: 6, fin: GO + 80_000, dist: 0 },
      { id: 'f', cp: 0, dist: 10 },
    ]
    expect(rankRacers(standings).map((s) => s.id)).toEqual(['e', 'b', 'd', 'c', 'a', 'f'])
    expect(standings.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    const tie: Standing[] = [
      { id: 'y', cp: 2, dist: 10 },
      { id: 'x', cp: 2, dist: 10 },
    ]
    expect(rankRacers(tie).map((s) => s.id)).toEqual(['x', 'y'])
  })
})

describe('W1 整備', () => {
  test('[W1-3] 連線整備固定 20 秒後進入 3 秒倒數；單人按「出發」前一直在整備，按下後倒數 3 秒', () => {
    expect(racePhase(meta, [], undefined, meta.at)).toBe('prep')
    expect(racePhase(meta, [], undefined, meta.at + PREP_MS - 1)).toBe('prep')
    expect(racePhase(meta, [], undefined, meta.at + PREP_MS)).toBe('countdown')
    expect(prepEnd(meta)).toBe(meta.at + 20_000)

    const waiting: RaceMeta = { ...meta, ready: null }
    expect(racePhase(waiting, [], undefined, meta.at + RACE_LIMIT_MS * 10)).toBe('prep')
    expect(raceOver(waiting, [], undefined, meta.at + RACE_LIMIT_MS * 10)).toBe(false)
    const ready: RaceMeta = { ...meta, ready: meta.at + 50_000 }
    expect(racePhase(ready, [], undefined, meta.at + 50_000)).toBe('countdown')
    expect(goTime(ready)).toBe(meta.at + 53_000)
    expect(racePhase(ready, [], undefined, meta.at + 53_000)).toBe('racing')
  })
})

describe('G4 比賽結束', () => {
  const running: Standing[] = [
    { id: 'u1', cp: 2, dist: 40 },
    { id: 'u2', cp: 1, dist: 40 },
    { id: 'ai0', cp: 3, dist: 40 },
  ]

  test('[G4-1] 所有選手完成、第一位完成後 30 秒、開賽後 5 分鐘，三者先到者結束比賽', () => {
    expect(racePhase(meta, running, undefined, meta.at + PREP_MS)).toBe('countdown')
    expect(racePhase(meta, running, undefined, GO - 1)).toBe('countdown')
    expect(goTime(meta)).toBe(GO)
    expect(racePhase(meta, running, undefined, GO)).toBe('racing')
    expect(raceOver(meta, running, undefined, GO + 60_000)).toBe(false)

    const allDone = running.map((s, k) => ({ ...s, cp: 6, fin: GO + 60_000 + k }))
    expect(firstFinish(allDone)).toBe(GO + 60_000)
    expect(raceOver(meta, allDone, firstFinish(allDone), GO + 60_002)).toBe(true)
    expect(racePhase(meta, allDone, firstFinish(allDone), GO + 60_002)).toBe('over')

    const oneDone = [{ ...running[0]!, cp: 6, fin: GO + 60_000 }, ...running.slice(1)]
    const first = firstFinish(oneDone)
    expect(raceOver(meta, oneDone, first, GO + 60_000 + FINISH_GRACE_MS - 1)).toBe(false)
    expect(raceOver(meta, oneDone, first, GO + 60_000 + FINISH_GRACE_MS)).toBe(true)

    const firstLeft = running.slice(1)
    expect(raceOver(meta, firstLeft, first, GO + 60_000 + FINISH_GRACE_MS - 1)).toBe(false)
    expect(raceOver(meta, firstLeft, first, GO + 60_000 + FINISH_GRACE_MS)).toBe(true)

    expect(firstFinish(running)).toBeUndefined()
    expect(raceOver(meta, running, undefined, GO + RACE_LIMIT_MS - 1)).toBe(false)
    expect(raceOver(meta, running, undefined, GO + RACE_LIMIT_MS)).toBe(true)
    expect(raceOver(meta, [], undefined, GO + 1000)).toBe(false)
  })

  test('AI 名字是「AI 1」到「AI 5」；AI 上限是 6 減玩家數', () => {
    expect([0, 1, 2, 3, 4].map(aiName)).toEqual(['AI 1', 'AI 2', 'AI 3', 'AI 4', 'AI 5'])
    expect([1, 2, 5, 6].map(aiLimit)).toEqual([5, 4, 1, 0])
  })
})

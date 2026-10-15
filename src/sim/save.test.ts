import { describe, expect, test } from 'vitest'
import { DEFAULT_BUILD, type Build } from './parts'
import { AUTOSAVE_INTERVAL, SAVE_VERSION, emptySave, loadSave, recordVisit, serializeSave, shouldSave } from './save'

describe('H3 拜訪手冊', () => {
  test('[H3-1] 第一次拜訪某戶時蓋章，重複拜訪不重複計算', () => {
    const first = recordVisit(emptySave('阿明'), 'h1')
    expect(first.visited).toEqual(['h1'])
    const again = recordVisit(first, 'h1')
    expect(again).toBe(first)
    expect(recordVisit(again, 'h2').visited).toEqual(['h1', 'h2'])
  })
})

describe('P1 讀存檔', () => {
  test('[P1-1] 存檔寫入後讀回內容相同（含組裝）', () => {
    const build: Build = { frame: 'carbon', wheel: 'slick', drive: 'single', bar: 'flat' }
    const save = { ...recordVisit(emptySave('小美'), 'h3'), odometer: 1234.5, build }
    expect(loadSave(serializeSave(save))).toEqual({ save, reset: false })
    expect(loadSave(null)).toEqual({ save: emptySave(''), reset: false })
  })

  test('[P1-2] 存檔損毀或版本不符時改用新存檔並回報需要提示玩家', () => {
    expect(loadSave('{not json')).toEqual({ save: emptySave(''), reset: true })
    const wrongVersion = JSON.stringify({ ...emptySave('x'), version: SAVE_VERSION + 1 })
    expect(loadSave(wrongVersion)).toEqual({ save: emptySave(''), reset: true })
    const badShape = JSON.stringify({ version: SAVE_VERSION, name: 3, visited: 'x', odometer: 'y' })
    expect(loadSave(badShape)).toEqual({ save: emptySave(''), reset: true })
    const overBudget = JSON.stringify({ ...emptySave('x'), build: { frame: 'carbon', wheel: 'grip', drive: 'tall', bar: 'stem' } })
    expect(loadSave(overBudget)).toEqual({ save: emptySave(''), reset: true })
  })

  test('[P1-2] 版本 1 的存檔升到版本 2：保留暱稱、拜訪紀錄、累計里程，組裝用預設', () => {
    expect(SAVE_VERSION).toBe(2)
    const v1 = JSON.stringify({ version: 1, name: '阿明', visited: ['h1', 'h2'], odometer: 88 })
    expect(loadSave(v1)).toEqual({ save: { version: 2, name: '阿明', visited: ['h1', 'h2'], odometer: 88, build: DEFAULT_BUILD }, reset: false })
  })
})

describe('P2 自動存檔', () => {
  test('[P2-1] 拜訪紀錄變動時立即存檔', () => {
    const prev = emptySave('a')
    const next = recordVisit(prev, 'h1')
    expect(shouldSave(prev, next, 1000, 1001)).toBe(true)
    expect(shouldSave(next, next, 1000, 1001)).toBe(false)
  })

  test('[P2-2] 每 10 秒自動存一次，含累計里程', () => {
    expect(AUTOSAVE_INTERVAL).toBe(10_000)
    const prev = emptySave('a')
    const next = { ...prev, odometer: 50 }
    expect(shouldSave(prev, next, 0, 9_999)).toBe(false)
    expect(shouldSave(prev, next, 0, 10_000)).toBe(true)
    expect(JSON.parse(serializeSave(next)).odometer).toBe(50)
  })
})

describe('W1 整備站', () => {
  test('[W1-4] 新存檔帶入預設組裝；組裝變動時立即存檔', () => {
    const prev = emptySave('a')
    expect(prev.build).toEqual(DEFAULT_BUILD)
    const next = { ...prev, build: { ...DEFAULT_BUILD, bar: 'flat' } }
    expect(shouldSave(prev, next, 1000, 1001)).toBe(true)
    expect(loadSave(serializeSave(next)).save.build).toEqual(next.build)
  })
})

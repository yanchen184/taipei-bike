import { describe, expect, test } from 'vitest'
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
  test('[P1-1] 存檔寫入後讀回內容相同', () => {
    const save = { ...recordVisit(emptySave('小美'), 'h3'), odometer: 1234.5 }
    expect(loadSave(serializeSave(save))).toEqual({ save, reset: false })
    expect(loadSave(null)).toEqual({ save: emptySave(''), reset: false })
  })

  test('[P1-2] 存檔損毀或版本不符時改用新存檔並回報需要提示玩家', () => {
    expect(loadSave('{not json')).toEqual({ save: emptySave(''), reset: true })
    const wrongVersion = JSON.stringify({ ...emptySave('x'), version: SAVE_VERSION + 1 })
    expect(loadSave(wrongVersion)).toEqual({ save: emptySave(''), reset: true })
    const badShape = JSON.stringify({ version: SAVE_VERSION, name: 3, visited: 'x', odometer: 'y' })
    expect(loadSave(badShape)).toEqual({ save: emptySave(''), reset: true })
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

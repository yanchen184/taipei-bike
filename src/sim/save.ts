import { DEFAULT_BUILD, isValidBuild, type Build } from './parts'

export const SAVE_VERSION = 2
export const SAVE_KEY = 'taipei-bike-save'
export const AUTOSAVE_INTERVAL = 10_000

export interface SaveData {
  version: number
  name: string
  visited: string[]
  odometer: number
  /** 上次整備完的組裝，下一局整備時帶入 */
  build: Build
}

export interface LoadResult {
  save: SaveData
  /** 原本的存檔不能用、已改成新存檔，畫面要告知玩家 */
  reset: boolean
}

export function emptySave(name: string): SaveData {
  return { version: SAVE_VERSION, name, visited: [], odometer: 0, build: DEFAULT_BUILD }
}

export function serializeSave(save: SaveData): string {
  return JSON.stringify(save)
}

/** 版本 1 沒有組裝，其他欄位與版本 2 相同 */
type SaveV1 = Omit<SaveData, 'version' | 'build'> & { version: 1 }

function hasCommonFields(v: Record<string, unknown>): boolean {
  return (
    typeof v.name === 'string' &&
    Array.isArray(v.visited) &&
    v.visited.every((id) => typeof id === 'string') &&
    typeof v.odometer === 'number' &&
    Number.isFinite(v.odometer)
  )
}

function isSaveV1(value: unknown): value is SaveV1 {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.version === 1 && hasCommonFields(v)
}

function isSaveData(value: unknown): value is SaveData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.version === SAVE_VERSION && hasCommonFields(v) && isValidBuild(v.build)
}

/** 版本 1 升到版本 2：保留暱稱、拜訪紀錄、累計里程，組裝用預設 */
function upgrade(v1: SaveV1): SaveData {
  return { version: SAVE_VERSION, name: v1.name, visited: [...v1.visited], odometer: v1.odometer, build: DEFAULT_BUILD }
}

export function loadSave(raw: string | null): LoadResult {
  if (raw === null) return { save: emptySave(''), reset: false }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isSaveData(parsed)) {
      const { version, name, visited, odometer, build } = parsed
      return { save: { version, name, visited: [...visited], odometer, build: { ...build } }, reset: false }
    }
    if (isSaveV1(parsed)) return { save: upgrade(parsed), reset: false }
  } catch {
    return { save: emptySave(''), reset: true }
  }
  return { save: emptySave(''), reset: true }
}

export function recordVisit(save: SaveData, homeId: string): SaveData {
  if (save.visited.includes(homeId)) return save
  return { ...save, visited: [...save.visited, homeId] }
}

/** 拜訪紀錄或組裝變動時立即存；其他變動每 10 秒存一次 */
export function shouldSave(prev: SaveData, next: SaveData, lastSavedAt: number, now: number): boolean {
  if (prev.visited !== next.visited || prev.name !== next.name || prev.build !== next.build) return true
  return now - lastSavedAt >= AUTOSAVE_INTERVAL
}

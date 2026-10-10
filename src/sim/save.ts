export const SAVE_VERSION = 1
export const SAVE_KEY = 'taipei-bike-save'
export const AUTOSAVE_INTERVAL = 10_000

export interface SaveData {
  version: number
  name: string
  visited: string[]
  odometer: number
}

export interface LoadResult {
  save: SaveData
  /** 原本的存檔不能用、已改成新存檔，畫面要告知玩家 */
  reset: boolean
}

export function emptySave(name: string): SaveData {
  return { version: SAVE_VERSION, name, visited: [], odometer: 0 }
}

export function serializeSave(save: SaveData): string {
  return JSON.stringify(save)
}

function isSaveData(value: unknown): value is SaveData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.version === SAVE_VERSION &&
    typeof v.name === 'string' &&
    Array.isArray(v.visited) &&
    v.visited.every((id) => typeof id === 'string') &&
    typeof v.odometer === 'number' &&
    Number.isFinite(v.odometer)
  )
}

export function loadSave(raw: string | null): LoadResult {
  if (raw === null) return { save: emptySave(''), reset: false }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isSaveData(parsed)) {
      return { save: { version: parsed.version, name: parsed.name, visited: [...parsed.visited], odometer: parsed.odometer }, reset: false }
    }
  } catch {
    return { save: emptySave(''), reset: true }
  }
  return { save: emptySave(''), reset: true }
}

export function recordVisit(save: SaveData, homeId: string): SaveData {
  if (save.visited.includes(homeId)) return save
  return { ...save, visited: [...save.visited, homeId] }
}

/** 拜訪紀錄變動時立即存；其他變動每 10 秒存一次 */
export function shouldSave(prev: SaveData, next: SaveData, lastSavedAt: number, now: number): boolean {
  if (prev.visited !== next.visited || prev.name !== next.name) return true
  return now - lastSavedAt >= AUTOSAVE_INTERVAL
}

import { BIKE_SPEC, type VehicleSpec } from './vehicle'

export type PartSlot = 'frame' | 'wheel' | 'drive' | 'bar'

/** 性能四項（§12-4）：極速、加速、過彎（m/s，低於這個速度轉向完全有效）、煞車 */
export interface Stats {
  top: number
  accel: number
  corner: number
  brake: number
}

export interface Part {
  id: string
  slot: PartSlot
  name: string
  price: number
  effect: Partial<Stats>
}

/** 每個部位選一款零件的 id */
export type Build = Readonly<Record<PartSlot, string>>

export const BUDGET = 1000
export const SLOTS: readonly PartSlot[] = ['frame', 'wheel', 'drive', 'bar']
export const SLOT_LABEL: Record<PartSlot, string> = { frame: '車架', wheel: '輪組', drive: '傳動', bar: '把手' }
export const STAT_LABEL: Record<keyof Stats, string> = { top: '極速', accel: '加速', corner: '過彎', brake: '煞車' }

/** 沒有任何加成時的腳踏車 */
export const BASE_STATS: Stats = { top: 12, accel: 3, corner: 6, brake: 10 }

/** 零件表（§12-5），每個部位第一款是最便宜、沒有加成的 */
export const PARTS: readonly Part[] = [
  { id: 'steel', slot: 'frame', name: '鋼管', price: 100, effect: {} },
  { id: 'alloy', slot: 'frame', name: '鋁合金', price: 300, effect: { accel: 0.5, corner: 1 } },
  { id: 'carbon', slot: 'frame', name: '碳纖', price: 500, effect: { top: 0.5, accel: 0.5, corner: 1 } },
  { id: 'commuter', slot: 'wheel', name: '通勤輪', price: 100, effect: {} },
  { id: 'slick', slot: 'wheel', name: '公路細胎', price: 300, effect: { top: 1.5, corner: -3 } },
  { id: 'grip', slot: 'wheel', name: '抓地寬胎', price: 300, effect: { corner: 3, brake: 3, top: -0.5 } },
  { id: 'single', slot: 'drive', name: '單速', price: 100, effect: {} },
  { id: 'tall', slot: 'drive', name: '重齒比', price: 300, effect: { top: 1, accel: -1 } },
  { id: 'short', slot: 'drive', name: '輕齒比', price: 300, effect: { accel: 1.5, top: -0.5 } },
  { id: 'flat', slot: 'bar', name: '平把', price: 100, effect: {} },
  { id: 'drop', slot: 'bar', name: '公路彎把', price: 200, effect: { top: 0.5, corner: -1 } },
  { id: 'stem', slot: 'bar', name: '短龍頭', price: 200, effect: { corner: 3 } },
]

/** 新存檔的預設組裝（§12-6） */
export const DEFAULT_BUILD: Build = { frame: 'alloy', wheel: 'commuter', drive: 'short', bar: 'stem' }

const BY_ID = new Map(PARTS.map((p) => [p.id, p]))

export function partsFor(slot: PartSlot): Part[] {
  return PARTS.filter((p) => p.slot === slot)
}

export function partOf(build: Build, slot: PartSlot): Part {
  const part = BY_ID.get(build[slot])
  if (!part || part.slot !== slot) throw new RangeError(`${SLOT_LABEL[slot]}沒有這款零件：${build[slot]}`)
  return part
}

export function buildPrice(build: Build): number {
  return SLOTS.reduce((sum, slot) => sum + partOf(build, slot).price, 0)
}

/** 四個部位都是零件表裡對應部位的零件，總價不超過預算 */
export function isValidBuild(value: unknown): value is Build {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (Object.keys(v).length !== SLOTS.length) return false
  const fits = SLOTS.every((slot) => {
    const id = v[slot]
    return typeof id === 'string' && BY_ID.get(id)?.slot === slot
  })
  return fits && buildPrice(v as Build) <= BUDGET
}

/** 把 slot 換成 id 後的組裝；換了會超過預算時回傳 null */
export function swapPart(build: Build, slot: PartSlot, id: string): Build | null {
  const next = { ...build, [slot]: id }
  return isValidBuild(next) ? next : null
}

/** 基準加上四個零件的效果 */
export function buildStats(build: Build): Stats {
  return SLOTS.reduce<Stats>((s, slot) => {
    const e = partOf(build, slot).effect
    return { top: s.top + (e.top ?? 0), accel: s.accel + (e.accel ?? 0), corner: s.corner + (e.corner ?? 0), brake: s.brake + (e.brake ?? 0) }
  }, BASE_STATS)
}

export function bikeSpec(build: Build): VehicleSpec {
  const s = buildStats(build)
  return { ...BIKE_SPEC, maxSpeed: s.top, accel: s.accel, corner: s.corner, brake: s.brake }
}

/** 四個零件名稱，成績表用 */
export function buildLabel(build: Build): string {
  return SLOTS.map((slot) => partOf(build, slot).name).join('＋')
}

/** 所有不超過預算的組裝，依零件表順序 */
export const LEGAL_BUILDS: readonly Build[] = partsFor('frame').flatMap((frame) =>
  partsFor('wheel').flatMap((wheel) =>
    partsFor('drive').flatMap((drive) =>
      partsFor('bar')
        .map((bar): Build => ({ frame: frame.id, wheel: wheel.id, drive: drive.id, bar: bar.id }))
        .filter((b) => buildPrice(b) <= BUDGET),
    ),
  ),
)

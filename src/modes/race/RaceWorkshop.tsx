import {
  BUDGET,
  LEGAL_BUILDS,
  SLOTS,
  SLOT_LABEL,
  STAT_LABEL,
  buildPrice,
  buildStats,
  partsFor,
  swapPart,
  type Build,
  type Part,
  type PartSlot,
  type Stats,
} from '../../sim/parts'
import type { RaceController } from './controller'
import { CoursePreview } from './CoursePreview'
import { useRaceView } from './useRaceView'

const STAT_KEYS = Object.keys(STAT_LABEL) as (keyof Stats)[]

/** 每項性能在所有合法組裝中的最大值，性能條以它為滿格 */
const STAT_MAX: Stats = LEGAL_BUILDS.map(buildStats).reduce((m, s) => ({
  top: Math.max(m.top, s.top),
  accel: Math.max(m.accel, s.accel),
  corner: Math.max(m.corner, s.corner),
  brake: Math.max(m.brake, s.brake),
}))

/** 零件效果，例如「極速 +1.5、過彎 −3」；沒有加成時為「—」 */
function effectText(part: Part): string {
  const items = STAT_KEYS.flatMap((k) => {
    const v = part.effect[k]
    return v === undefined ? [] : [`${STAT_LABEL[k]} ${v > 0 ? '+' : '−'}${Math.abs(v)}`]
  })
  return items.length === 0 ? '—' : items.join('、')
}

function SlotPicker({ slot, build, onPick }: { slot: PartSlot; build: Build; onPick: (slot: PartSlot, id: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-bold text-white/80">{SLOT_LABEL[slot]}</legend>
      <div className="grid grid-cols-3 gap-1.5">
        {partsFor(slot).map((part) => {
          const selected = build[slot] === part.id
          const affordable = selected || swapPart(build, slot, part.id) !== null
          return (
            <button
              key={part.id}
              type="button"
              data-testid="workshop-part"
              data-slot={slot}
              data-id={part.id}
              aria-pressed={selected}
              disabled={!affordable}
              onClick={() => onPick(slot, part.id)}
              className={`rounded-lg border px-2 py-1.5 text-left text-xs leading-snug transition disabled:cursor-not-allowed disabled:opacity-35 ${
                selected ? 'border-amber-300 bg-amber-400 text-stone-900' : 'border-white/20 bg-white/10 hover:bg-white/20'
              }`}
            >
              <span className="block text-sm font-bold">{part.name}</span>
              <span className="block tabular-nums">{part.price} 元</span>
              <span className="block opacity-80">{effectText(part)}</span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function StatBars({ build }: { build: Build }) {
  const stats = buildStats(build)
  return (
    <div className="space-y-1">
      {STAT_KEYS.map((k) => (
        <div key={k} data-testid="workshop-stat" data-stat={k} data-value={stats[k]} className="flex items-center gap-2 text-sm">
          <span className="w-10 shrink-0">{STAT_LABEL[k]}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${(stats[k] / STAT_MAX[k]) * 100}%` }} />
          </div>
          <span className="w-9 shrink-0 text-right tabular-nums">{stats[k]}</span>
        </div>
      ))}
    </div>
  )
}

/** 整備站（§12-2）：左邊本局賽道，右邊四個部位、性能條與剩餘預算；單人按「出發」，連線顯示整備倒數 */
export function RaceWorkshop({ controller }: { controller: RaceController }) {
  const v = useRaceView(controller)
  const course = controller.course()
  if (!course) return null
  const left = BUDGET - buildPrice(v.build)
  return (
    <div
      data-testid="race-workshop"
      className="pointer-events-auto absolute inset-0 overflow-y-auto bg-stone-950/95 px-4 py-6 text-white"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-5 md:flex-row">
        <section className="md:w-5/12">
          <h2 className="mb-2 text-xl font-black">整備站 · 第 {v.n} 局</h2>
          <CoursePreview course={course} />
        </section>
        <section className="flex-1 space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="font-bold">組裝你的腳踏車</span>
            <span className="text-sm">
              剩餘預算{' '}
              <b data-testid="workshop-budget" className="tabular-nums text-amber-300">
                {left}
              </b>{' '}
              / {BUDGET} 元
            </span>
          </div>
          {SLOTS.map((slot) => (
            <SlotPicker key={slot} slot={slot} build={v.build} onPick={(s, id) => controller.pickPart(s, id)} />
          ))}
          <StatBars build={v.build} />
          <div className="flex items-center justify-between gap-3 pt-1">
            <button type="button" data-testid="race-quit" className="rounded-lg bg-white/10 px-4 py-2 font-bold" onClick={() => controller.leave()}>
              退出比賽
            </button>
            {v.prepLeft === null ? (
              <button
                type="button"
                data-testid="race-go"
                className="rounded-lg bg-amber-400 px-6 py-2 text-lg font-black text-stone-900 shadow"
                onClick={() => controller.go()}
              >
                出發
              </button>
            ) : (
              <span data-testid="race-prep-left" className="rounded-lg bg-white/10 px-4 py-2 font-bold">
                整備剩 <span className="tabular-nums text-amber-300">{v.prepLeft}</span> 秒
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

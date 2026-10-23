import { BUDGET, SLOTS, buildPrice } from '../../sim/parts'
import { SlotPicker, StatBars } from '../../ui/PartPicker'
import type { RaceController } from './controller'
import { CoursePreview } from './CoursePreview'
import { useRaceView } from './useRaceView'

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

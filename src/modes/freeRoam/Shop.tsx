import { useState } from 'react'
import { useEngine } from '../../game/EngineContext'
import { BUDGET, SLOTS, buildPrice, swapPart, type Build, type PartSlot } from '../../sim/parts'
import { SlotPicker, StatBars } from '../../ui/PartPicker'

/** 自由逛街的商店（§2-10）：跟整備站右半邊一樣，按「裝上」才存檔 */
export function Shop({ onClose }: { onClose: () => void }) {
  const engine = useEngine()
  const [draft, setDraft] = useState<Build>(() => engine.state.save.build)
  const left = BUDGET - buildPrice(draft)

  const pick = (slot: PartSlot, id: string) => {
    const next = swapPart(draft, slot, id)
    if (next) setDraft(next)
  }
  const equip = () => {
    engine.equip(draft)
    onClose()
  }

  return (
    <div data-testid="shop" className="pointer-events-auto absolute inset-0 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-6 text-white">
      <section className="w-full max-w-xl space-y-3 rounded-2xl bg-stone-950/95 p-5 shadow-xl">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-black">腳踏車店</h2>
          <span className="text-sm">
            剩餘預算{' '}
            <b data-testid="workshop-budget" className="tabular-nums text-amber-300">
              {left}
            </b>{' '}
            / {BUDGET} 元
          </span>
        </div>
        {SLOTS.map((slot) => (
          <SlotPicker key={slot} slot={slot} build={draft} onPick={pick} />
        ))}
        <StatBars build={draft} />
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" data-testid="shop-cancel" className="rounded-lg bg-white/10 px-4 py-2 font-bold" onClick={onClose}>
            取消
          </button>
          <button type="button" data-testid="shop-equip" className="rounded-lg bg-amber-400 px-6 py-2 text-lg font-black text-stone-900 shadow" onClick={equip}>
            裝上
          </button>
        </div>
      </section>
    </div>
  )
}

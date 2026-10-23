import { useState } from 'react'
import { useEngine, useHud } from '../../game/EngineContext'
import { Shop } from './Shop'

export function FreeRoamHud() {
  const engine = useEngine()
  const hud = useHud()
  const [shopOpen, setShopOpen] = useState(false)
  const canSummon = hud.mode !== 'drive' && hud.homeId === null
  return (
    <>
      {hud.prompt && (
        <div data-testid="prompt" className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-lg bg-black/70 px-4 py-2 text-lg text-white">
          {hud.prompt}
        </div>
      )}
      {hud.greeting && (
        <div data-testid="greeting" className="absolute top-24 left-1/2 -translate-x-1/2 rounded-2xl bg-white/90 px-5 py-3 text-lg text-stone-800 shadow">
          {hud.greeting}
        </div>
      )}
      <div className="absolute left-4 top-32 flex flex-col gap-2">
        <button
          type="button"
          data-testid="open-shop"
          className="rounded-xl bg-amber-400 px-4 py-2 font-bold text-stone-900 shadow"
          onClick={() => setShopOpen(true)}
        >
          進入商店
        </button>
        <button
          type="button"
          data-testid="summon-bike"
          disabled={!canSummon}
          className="rounded-xl bg-emerald-500 px-4 py-2 font-bold text-white shadow disabled:cursor-not-allowed disabled:opacity-40"
          onClick={(e) => {
            engine.action('summonBike')
            e.currentTarget.blur()
          }}
        >
          召喚腳踏車 (B)
        </button>
      </div>
      {shopOpen && <Shop onClose={() => setShopOpen(false)} />}
    </>
  )
}

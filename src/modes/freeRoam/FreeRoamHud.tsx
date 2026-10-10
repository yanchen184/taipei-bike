import { useHud } from '../../game/EngineContext'

export function FreeRoamHud() {
  const hud = useHud()
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
    </>
  )
}

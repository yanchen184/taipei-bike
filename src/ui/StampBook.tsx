import { useEngine, useHud } from '../game/EngineContext'

/** 拜訪手冊：已拜訪 x / 全部，以及全部門牌（已拜訪的蓋章） */
export function StampBook() {
  const engine = useEngine()
  const hud = useHud()
  if (!hud.bookOpen) return null
  const visited = new Set(engine.state.save.visited)
  const homes = engine.city.homes
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/40" onClick={() => engine.action('close')}>
      <section
        data-testid="stamp-book"
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-amber-50 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="text-2xl font-black text-stone-800">拜訪手冊</h2>
          <span data-testid="book-count" className="font-bold text-stone-700">
            已拜訪 {hud.visited} / {homes.length}
          </span>
        </header>
        <ul className="space-y-1">
          {homes.map((home) => {
            const done = visited.has(home.id)
            return (
              <li key={home.id} data-testid="book-entry" data-visited={done} className="flex items-center justify-between rounded px-2 py-1 odd:bg-amber-100/60">
                <span className={done ? 'text-stone-900' : 'text-stone-400'}>{home.address}</span>
                <span className="text-lg">{done ? '🏮' : '・'}</span>
              </li>
            )
          })}
        </ul>
        <p className="mt-4 text-center text-sm text-stone-500">按 M 或 Esc 關閉</p>
      </section>
    </div>
  )
}

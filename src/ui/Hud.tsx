import { useHud } from '../game/EngineContext'

const MODE_LABEL = { walk: '步行', drive: '開車', bike: '騎車' } as const

const CONTROLS = 'WASD 移動　Shift 跑　E 上下車／進門　Q 叫車　R 扶正　C 視角　H 喇叭　M 手冊　拖曳滑鼠轉視角'

export function Hud() {
  const hud = useHud()
  return (
    <>
      <div className="pointer-events-none absolute left-4 top-4 space-y-1 rounded-xl bg-black/55 px-4 py-3 text-white">
        <div data-testid="clock" className="text-2xl font-bold tabular-nums">
          {hud.clock} {hud.night ? '🌙' : '☀️'}
        </div>
        <div data-testid="mode">{hud.placeLabel ?? MODE_LABEL[hud.mode]}</div>
        <div data-testid="visited">已拜訪 {hud.visited} 戶</div>
      </div>
      {hud.mode !== 'walk' && (
        <div data-testid="speed" className="pointer-events-none absolute bottom-6 right-6 rounded-xl bg-black/55 px-5 py-3 text-right text-white">
          <span className="text-4xl font-black tabular-nums">{hud.speedKmh}</span>
          <span className="ml-1 text-sm">km/h</span>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/40 px-3 py-1 text-xs text-white/90">
        {CONTROLS}
      </div>
    </>
  )
}

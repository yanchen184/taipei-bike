import { useHud } from '../game/EngineContext'

/** 比賽騎車時右下角是小地圖，速度表放在它左邊 */
const MINIMAP_GAP = 'right-[13rem]'

const MODE_LABEL = { walk: '步行', drive: '開車', bike: '騎車' } as const

const CONTROLS = 'WASD 移動　Shift 跑　E 上下車／進門　Q 叫車　R 扶正　C 視角　H 喇叭　M 手冊　拖曳滑鼠轉視角'
/** 規則 §7「比賽騎車」那一欄 */
const RACE_CONTROLS = 'W 踩踏　S 煞車／倒退　A／D 轉向　R 回檢查點　C 視角　M 選單　拖曳滑鼠轉視角'

export function Hud() {
  const hud = useHud()
  // 腳踏車只在比賽中騎
  const riding = hud.mode === 'bike'
  return (
    <>
      <div className="pointer-events-none absolute left-4 top-4 space-y-1 rounded-xl bg-black/55 px-4 py-3 text-white">
        <div data-testid="clock" className="text-2xl font-bold tabular-nums">
          {hud.clock} {hud.night ? '🌙' : '☀️'}
        </div>
        <div data-testid="mode">{hud.placeLabel ?? MODE_LABEL[hud.mode]}</div>
        {!riding && <div data-testid="visited">已拜訪 {hud.visited} 戶</div>}
      </div>
      {hud.mode !== 'walk' && (
        <div data-testid="speed" className={`pointer-events-none absolute bottom-6 rounded-xl bg-black/55 px-5 py-3 text-right text-white ${riding ? MINIMAP_GAP : 'right-6'}`}>
          <span className="text-4xl font-black tabular-nums">{hud.speedKmh}</span>
          <span className="ml-1 text-sm">km/h</span>
        </div>
      )}
      {hud.fallen && (
        <div data-testid="fallen" className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 rounded-xl bg-red-600/85 px-6 py-3 text-3xl font-black text-white">
          摔車了！
        </div>
      )}
      <div data-testid="controls" className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/40 px-3 py-1 text-xs text-white/90">
        {riding ? RACE_CONTROLS : CONTROLS}
      </div>
    </>
  )
}

import type { TurnKind } from '../../sim/course'
import type { RaceController, ResultRow } from './controller'
import { RaceMinimap } from './RaceMinimap'
import { RaceWorkshop } from './RaceWorkshop'
import { useRaceView } from './useRaceView'

/** 毫秒 → m:ss.d */
export function formatRaceTime(ms: number): string {
  const tenths = Math.floor(ms / 100)
  const minutes = Math.floor(tenths / 600)
  const seconds = Math.floor((tenths % 600) / 10)
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths % 10}`
}

const TURN_LABEL: Record<TurnKind, string> = { left: '左轉', right: '右轉', straight: '直行', finish: '終點' }
const TURN_ICON: Record<TurnKind, string> = { left: '↰', right: '↱', straight: '↑', finish: '🏁' }

const BUTTON = 'pointer-events-auto rounded-lg px-4 py-2 font-bold shadow'

function Results({ rows, host, controller }: { rows: readonly ResultRow[]; host: boolean; controller: RaceController }) {
  return (
    <div
      data-testid="race-results"
      className="absolute left-1/2 top-1/2 w-[26rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white/95 p-5 text-stone-800 shadow-xl"
    >
      <h2 className="mb-3 text-center text-xl font-black">比賽結果</h2>
      <table className="w-full text-left">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid="race-result-row" className="border-t border-stone-200">
              <td className="py-1 pr-2 font-bold tabular-nums">{r.rank}</td>
              <td className="py-1">
                <span className="block">{r.name}</span>
                <span data-testid="race-result-build" className="block text-xs text-stone-500">
                  {r.build ?? '—'}
                </span>
              </td>
              <td className="py-1 text-right tabular-nums">{r.time === null ? '未完成' : formatRaceTime(r.time)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex justify-center gap-3">
        <button type="button" data-testid="race-back" className={`${BUTTON} bg-stone-200`} onClick={() => controller.leave()}>
          回到城市
        </button>
        {host && (
          <button type="button" data-testid="race-again" className={`${BUTTON} bg-amber-400`} onClick={() => void controller.again()}>
            再來一局
          </button>
        )}
      </div>
    </div>
  )
}

export function RaceHud({ controller }: { controller: RaceController }) {
  const v = useRaceView(controller)
  if (v.phase === 'prep') return <RaceWorkshop controller={controller} />
  return (
    <div data-testid="race-hud">
      <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 flex-col items-center gap-2">
        <div className="flex gap-5 rounded-xl bg-black/60 px-5 py-2 text-white">
          <span data-testid="race-cp">
            檢查點 {v.cp} / {v.cps}
          </span>
          <span data-testid="race-time" className="tabular-nums">
            {formatRaceTime(v.elapsed)}
          </span>
          <span data-testid="race-rank">
            第 {v.rank} / {v.total} 名
          </span>
        </div>
        {v.turn && (
          <div data-testid="race-turn" data-kind={v.turn} className="flex items-center gap-2 rounded-xl bg-black/60 px-4 py-1.5 text-lg font-bold text-white">
            <span aria-hidden="true" className="text-2xl leading-none">
              {TURN_ICON[v.turn]}
            </span>
            <span>
              前方 <span className="tabular-nums">{v.turnDist}</span> m {TURN_LABEL[v.turn]}
            </span>
          </div>
        )}
        {(v.draft > 0 || v.catchup > 0) && (
          <div className="flex gap-2 text-sm font-bold text-white">
            {v.draft > 0 && (
              <span data-testid="race-draft" className="rounded-lg bg-sky-600/80 px-3 py-1">
                破風 {v.draft}%
              </span>
            )}
            {v.catchup > 0 && (
              <span data-testid="race-catchup" className="rounded-lg bg-orange-600/80 px-3 py-1">
                後追 {v.catchup}%
              </span>
            )}
          </div>
        )}
      </div>
      <RaceMinimap controller={controller} />
      {v.phase === 'countdown' && (
        <div data-testid="race-countdown" className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 text-8xl font-black text-white drop-shadow-lg">
          {v.countdown}
        </div>
      )}
      {v.finished && v.phase !== 'over' && (
        <div data-testid="race-finished" className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 rounded-xl bg-black/60 px-6 py-3 text-2xl font-bold text-white">
          完成！{formatRaceTime(v.elapsed)}，等待其他選手
        </div>
      )}
      {v.phase !== 'over' && (
        <button type="button" data-testid="race-quit" className={`${BUTTON} absolute bottom-6 left-4 bg-black/60 text-white`} onClick={() => controller.leave()}>
          退出比賽
        </button>
      )}
      {v.results && <Results rows={v.results} host={v.host} controller={controller} />}
    </div>
  )
}

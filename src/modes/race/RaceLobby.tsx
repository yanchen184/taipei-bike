import { useState } from 'react'
import type { RaceController } from './controller'

const DEFAULT_AI = 3

/** 自由逛街時左下角的開賽面板；只有房主能選 AI 數量與開始 */
export function RaceLobby({ controller }: { controller: RaceController }) {
  const limit = controller.aiLimit()
  const [ai, setAi] = useState(Math.min(DEFAULT_AI, limit))
  const [starting, setStarting] = useState(false)
  const count = Math.min(ai, limit)

  const start = () => {
    setStarting(true)
    void controller.start(count).finally(() => setStarting(false))
  }

  return (
    <div data-testid="race-lobby" className="absolute bottom-10 left-4 w-52 space-y-2 rounded-xl bg-black/60 px-4 py-3 text-white">
      <div className="font-bold">腳踏車競速</div>
      {controller.isHost() ? (
        <>
          <label className="flex items-center justify-between text-sm">
            AI 數量
            <select
              data-testid="race-ai-count"
              className="rounded bg-white px-2 py-0.5 text-stone-800"
              value={count}
              onChange={(e) => setAi(Number(e.target.value))}
            >
              {Array.from({ length: limit + 1 }, (_, k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-testid="race-start"
            disabled={starting}
            className="w-full rounded-lg bg-amber-400 py-1.5 font-bold text-stone-900 disabled:opacity-50"
            onClick={start}
          >
            開始比賽
          </button>
        </>
      ) : (
        <p data-testid="race-wait" className="text-sm text-white/80">
          等待房主開始比賽
        </p>
      )}
    </div>
  )
}

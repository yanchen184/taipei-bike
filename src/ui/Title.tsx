import { useState, type FormEvent } from 'react'
import { NAME_MAX, NAME_MIN, ROOM_CODE_LENGTH, isValidName } from '../sim/sync'

interface TitleProps {
  initialName: string
  saveWasReset: boolean
  onStart: (name: string) => void
  /** code 為 null 時建立房間；失敗時 reject，訊息顯示給玩家 */
  onOnline: (name: string, code: string | null) => Promise<void>
}

export function Title({ initialName, saveWasReset, onStart, onOnline }: TitleProps) {
  const [name, setName] = useState(initialName)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = isValidName(name)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (valid && !busy) onStart(name.trim())
  }

  const online = (roomCode: string | null) => {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    onOnline(name.trim(), roomCode).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    })
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-sky-300 to-amber-100 p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl bg-white/90 p-8 shadow-xl">
        <h1 className="text-center text-4xl font-black tracking-wide text-stone-800">台北狂騎</h1>
        <p data-testid="subtitle" className="text-center text-stone-600">
          在台北街頭開車、騎車、到別人家坐坐，還能和朋友連線比賽
        </p>
        {saveWasReset && (
          <p role="alert" data-testid="save-reset" className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
            舊的存檔無法讀取，已改用新的存檔。
          </p>
        )}
        <label className="block space-y-1">
          <span className="text-sm font-medium text-stone-700">暱稱</span>
          <input
            data-testid="name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX * 2}
            autoFocus
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-lg outline-none focus:border-sky-500"
          />
          {!valid && name.length > 0 && (
            <span className="text-sm text-red-600">
              暱稱需要 {NAME_MIN}–{NAME_MAX} 個字
            </span>
          )}
          {name.length === 0 && (
            <span data-testid="name-hint" className="text-sm text-stone-500">
              先輸入 {NAME_MIN}–{NAME_MAX} 字的暱稱，才能開始或連線
            </span>
          )}
        </label>
        <button
          type="submit"
          data-testid="start-solo"
          disabled={!valid || busy}
          className="w-full rounded-lg bg-amber-400 py-3 text-lg font-bold text-stone-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          單人開始
        </button>
        <fieldset
          disabled={!valid || busy}
          aria-labelledby="online-heading"
          className="space-y-3 border-t border-stone-200 pt-5"
        >
          <div className="space-y-1">
            <h2 id="online-heading" className="text-lg font-bold text-stone-800">
              和朋友連線
            </h2>
            <p className="text-sm text-stone-600">建立房間，把 {ROOM_CODE_LENGTH} 碼房號傳給朋友；有房號就輸入後按「加入」。</p>
          </div>
          <button
            type="button"
            data-testid="create-room"
            onClick={() => online(null)}
            className="w-full rounded-lg bg-sky-500 py-2.5 font-bold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            建立房間
          </button>
          <div className="flex gap-2">
            <input
              data-testid="room-code-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={`${ROOM_CODE_LENGTH} 碼房號`}
              maxLength={ROOM_CODE_LENGTH + 2}
              aria-label="房號"
              className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2 text-lg uppercase tracking-widest outline-none focus:border-sky-500 disabled:opacity-50"
            />
            <button
              type="button"
              data-testid="join-room"
              onClick={() => online(code)}
              disabled={code.trim().length === 0}
              className="rounded-lg bg-sky-500 px-5 font-bold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              加入
            </button>
          </div>
          {busy && <p className="text-center text-sm text-stone-500">連線中…</p>}
          {error && (
            <p role="alert" data-testid="room-error" className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}
        </fieldset>
      </form>
    </main>
  )
}

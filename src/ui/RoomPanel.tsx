import { useOnline, useRoomError, useRoster } from '../game/OnlineContext'

/** 連線時右上角顯示房號與房內玩家 */
export function RoomPanel() {
  const online = useOnline()
  const roster = useRoster(online)
  const error = useRoomError(online)
  if (!online) return null
  return (
    <div className="pointer-events-none absolute right-4 top-4 w-48 space-y-2 rounded-xl bg-black/55 px-4 py-3 text-white">
      <div className="text-sm text-white/80">
        房號 <span data-testid="room-code" className="ml-1 text-xl font-black tracking-widest text-amber-300">{online.link.code}</span>
      </div>
      <ul className="space-y-0.5 text-sm">
        {roster.map((p) => (
          <li key={p.uid} data-testid="room-player" data-host={p.host} className={p.me ? 'font-bold' : undefined}>
            {p.name}
            {p.host && <span className="ml-1 rounded bg-amber-400 px-1 text-xs text-stone-900">房主</span>}
            {p.me && <span className="ml-1 text-xs text-white/70">（你）</span>}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" data-testid="room-sync-error" className="text-xs text-red-300">
          連線錯誤：{error}
        </p>
      )}
    </div>
  )
}

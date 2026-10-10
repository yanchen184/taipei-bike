import { createContext, useContext, useSyncExternalStore } from 'react'
import type { OnlineSession, RemoteEntry, RosterEntry } from './online'

/** 單人遊玩時為 null */
export const OnlineContext = createContext<OnlineSession | null>(null)

export function useOnline(): OnlineSession | null {
  return useContext(OnlineContext)
}

const NONE: readonly never[] = []
const noop = () => () => {}

export function useRemotes(online: OnlineSession | null): readonly RemoteEntry[] {
  return useSyncExternalStore(online?.store.subscribe ?? noop, online?.store.getRemotes ?? (() => NONE))
}

export function useRoster(online: OnlineSession | null): readonly RosterEntry[] {
  return useSyncExternalStore(online?.store.subscribe ?? noop, online?.store.getRoster ?? (() => NONE))
}

export function useRoomError(online: OnlineSession | null): string | null {
  return useSyncExternalStore(online?.store.subscribe ?? noop, online?.store.getError ?? (() => null))
}

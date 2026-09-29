import { useCallback, useSyncExternalStore } from 'react'
import { createPlayerPreferenceStore, PLAYER_PREFERENCE_PREFIX } from '../lib/playerPreference'
import { useLeague } from '../context/LeagueContext'

const store = createPlayerPreferenceStore(() => typeof window === 'undefined' ? undefined : window.localStorage)

function subscribe(listener: () => void) {
  const unsubscribe = store.subscribe(listener)
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null) store.refresh()
    else if (event.key.startsWith(PLAYER_PREFERENCE_PREFIX)) {
      store.refresh(event.key.slice(PLAYER_PREFERENCE_PREFIX.length))
    }
  }
  window.addEventListener('storage', handleStorage)
  return () => {
    unsubscribe()
    window.removeEventListener('storage', handleStorage)
  }
}

export function usePlayerPreference() {
  const { league } = useLeague()
  const getSnapshot = useCallback(() => store.get(league.id), [league.id])
  const preference = useSyncExternalStore(subscribe, getSnapshot)
  const selectPlayer = (playerId: string | null) => store.set(league.id, playerId, preference.remember)
  const setRemember = (remember: boolean) => store.set(league.id, preference.playerId, remember)
  return { ...preference, selectPlayer, setRemember }
}

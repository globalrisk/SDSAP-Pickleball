export interface PlayerPreference {
  playerId: string | null
  remember: boolean
  storageAvailable: boolean
}

export const PLAYER_PREFERENCE_PREFIX = 'pickleball-player:v1:'

/** A browsing preference only; selecting a player never changes authorization. */
export function createPlayerPreferenceStore(getStorage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined) {
  const preferences = new Map<string, PlayerPreference>()
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())

  function get(leagueId: string): PlayerPreference {
    const cached = preferences.get(leagueId)
    if (cached) return cached
    let playerId: string | null = null
    let storageAvailable = false
    try {
      const storage = getStorage()
      storageAvailable = Boolean(storage)
      playerId = storage?.getItem(`${PLAYER_PREFERENCE_PREFIX}${leagueId}`) || null
    } catch { storageAvailable = false }
    const preference = { playerId, remember: true, storageAvailable }
    preferences.set(leagueId, preference)
    return preference
  }

  return {
    get,
    set(leagueId: string, playerId: string | null, remember: boolean) {
      let storageAvailable = false
      try {
        const storage = getStorage()
        if (remember && playerId) storage?.setItem(`${PLAYER_PREFERENCE_PREFIX}${leagueId}`, playerId)
        else storage?.removeItem(`${PLAYER_PREFERENCE_PREFIX}${leagueId}`)
        storageAvailable = Boolean(storage)
      } catch { /* Keep the selection in memory when storage is unavailable. */ }
      preferences.set(leagueId, { playerId, remember, storageAvailable })
      notify()
    },
    refresh(leagueId?: string) {
      if (leagueId) preferences.delete(leagueId)
      else preferences.clear()
      notify()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

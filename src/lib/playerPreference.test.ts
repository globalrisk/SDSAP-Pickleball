import { describe, expect, it } from 'vitest'
import { createPlayerPreferenceStore, PLAYER_PREFERENCE_PREFIX } from './playerPreference'

function storage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value) },
    removeItem: (key: string) => { items.delete(key) },
  }
}

describe('remembered player preference', () => {
  it('remembers a player after a fresh visit and keeps leagues separate', () => {
    const browserStorage = storage()
    const store = createPlayerPreferenceStore(() => browserStorage)
    store.set('sdsap', 'player-a', true)
    store.set('open', 'player-b', true)
    const fresh = createPlayerPreferenceStore(() => browserStorage)
    expect(fresh.get('sdsap').playerId).toBe('player-a')
    expect(fresh.get('open').playerId).toBe('player-b')
  })

  it('removes a remembered selection when remembering is turned off', () => {
    const browserStorage = storage()
    const store = createPlayerPreferenceStore(() => browserStorage)
    store.set('league', 'a', true)
    store.set('league', 'a', false)
    expect(store.get('league').playerId).toBe('a')
    expect(createPlayerPreferenceStore(() => browserStorage).get('league').playerId).toBeNull()
    store.set('league', 'b', false)
    expect(browserStorage.getItem(`${PLAYER_PREFERENCE_PREFIX}league`)).toBeNull()
  })

  it('clears the selection and rereads external changes', () => {
    const browserStorage = storage()
    const store = createPlayerPreferenceStore(() => browserStorage)
    store.set('league', 'a', true)
    store.set('league', null, true)
    expect(createPlayerPreferenceStore(() => browserStorage).get('league').playerId).toBeNull()
    browserStorage.setItem(`${PLAYER_PREFERENCE_PREFIX}league`, 'b')
    store.refresh('league')
    expect(store.get('league').playerId).toBe('b')
  })

  it('continues in memory when browser storage is denied', () => {
    const store = createPlayerPreferenceStore(() => { throw new Error('Storage denied') })
    expect(store.get('league').storageAvailable).toBe(false)
    expect(() => store.set('league', 'a', true)).not.toThrow()
    expect(store.get('league')).toEqual({ playerId: 'a', remember: true, storageAvailable: false })
  })
})

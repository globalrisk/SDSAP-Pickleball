import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { clearPrivateQueries } from './privateQueries'

describe('Private profile cache isolation', () => {
  it('removes only the departing user’s private queries', async () => {
    const client = new QueryClient()
    const oldWallet = ['bets', 'wallet', 'league', 'old-user', 'player']
    const newWallet = ['bets', 'wallet', 'league', 'new-user', 'player']
    for (const key of [oldWallet, newWallet, ['player-account', 'old-user'], ['admin-username', 'old-user'], ['player-skill-rating', 'old-user', 'player', 'league', 'target'], ['player-skills', 'target'], ['player-profile', 'league', 'player']]) client.setQueryData(key, 'data')
    await clearPrivateQueries(client, 'old-user')
    expect(client.getQueryData(oldWallet)).toBeUndefined()
    expect(client.getQueryData(['player-account', 'old-user'])).toBeUndefined()
    expect(client.getQueryData(['admin-username', 'old-user'])).toBeUndefined()
    expect(client.getQueryData(newWallet)).toBe('data')
    expect(client.getQueryData(['player-skill-rating', 'old-user', 'player', 'league', 'target'])).toBeUndefined()
    expect(client.getQueryData(['player-skills', 'target'])).toBe('data')
    expect(client.getQueryData(['player-profile', 'league', 'player'])).toBe('data')
  })
  it('discards an old ownership link without deleting a replacement link’s data', async () => {
    const client = new QueryClient()
    const oldKey = ['bets', 'history', 'league', 'user', 'old-player']
    const newKey = ['bets', 'history', 'league', 'user', 'new-player']
    client.setQueryData(oldKey, 'old'); client.setQueryData(newKey, 'new')
    client.setQueryData(['player-account', 'user'], { playerId: 'new-player' })
    client.setQueryData(['player-skill-rating', 'user', 'old-player', 'league', 'target'], 'old-vote')
    client.setQueryData(['player-skill-rating', 'user', 'new-player', 'league', 'target'], 'new-vote')
    await clearPrivateQueries(client, 'user', 'old-player')
    expect(client.getQueryData(oldKey)).toBeUndefined()
    expect(client.getQueryData(newKey)).toBe('new')
    expect(client.getQueryData(['player-skill-rating', 'user', 'old-player', 'league', 'target'])).toBeUndefined()
    expect(client.getQueryData(['player-skill-rating', 'user', 'new-player', 'league', 'target'])).toBe('new-vote')
    expect(client.getQueryData(['player-account', 'user'])).toEqual({ playerId: 'new-player' })
  })
  it('cancels in-flight private responses before they can repopulate the cache', async () => {
    const client = new QueryClient()
    const key = ['bets', 'wallet', 'league', 'old-user', 'player']
    let resolve: (value: string) => void = () => {}
    const request = client.fetchQuery({ queryKey: key, queryFn: () => new Promise<string>(done => { resolve = done }) }).catch(() => null)
    await clearPrivateQueries(client, 'old-user')
    resolve('private balance')
    await request
    expect(client.getQueryData(key)).toBeUndefined()
  })
})

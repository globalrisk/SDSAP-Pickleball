import { describe, expect, it } from 'vitest'
import { hasBetFunds, matchBettingStatus } from './matchBetting'
import type { MatchWithTeams } from '../types'

const match = {
  status: 'scheduled', live_status: 'available', betting_closed_at: null,
  home_pool_player_ids: ['h1', 'h2'], away_pool_player_ids: ['a1', 'a2'],
  home_team: { players: [{ pool_player_id: 'h1' }, { pool_player_id: 'bench' }] },
  away_team: { players: [{ pool_player_id: 'a1' }] },
} as MatchWithTeams

describe('match betting eligibility', () => {
  it('blocks actual participants, while allowing another member of their squad', () => {
    expect(matchBettingStatus(match, 'h2')).toBe('participant')
    expect(matchBettingStatus(match, 'a2')).toBe('participant')
    expect(matchBettingStatus(match, 'bench')).toBe('open')
  })
  it('keeps betting closed when a previously started match returns to the queue', () => {
    expect(matchBettingStatus({ ...match, betting_closed_at: '2026-10-13T00:00:00Z' }, 'bench')).toBe('closed')
    expect(matchBettingStatus({ ...match, live_status: 'playing' }, 'bench')).toBe('closed')
    expect(matchBettingStatus({ ...match, status: 'completed' }, 'bench')).toBe('closed')
    expect(matchBettingStatus({ ...match, status: 'forfeit' }, 'bench')).toBe('closed')
  })
  it('uses current pair identities when a legacy match has no lineup snapshot', () => {
    expect(matchBettingStatus({ ...match, home_pool_player_ids: null }, 'bench')).toBe('participant')
  })
})

describe('available betting funds', () => {
  it('compares fractional balances precisely at the stake boundary', () => {
    expect(hasBetFunds('999.999999', '1000')).toBe(false)
    expect(hasBetFunds('1000.000000', '1000')).toBe(true)
    expect(hasBetFunds('1000.000001', '1000')).toBe(true)
    expect(hasBetFunds('39000.000000', '4000.000000')).toBe(true)
    expect(hasBetFunds('3999.999999', '4000.000000')).toBe(false)
    expect(hasBetFunds('9007199254740992.999999', '9007199254740993')).toBe(false)
  })
  it('blocks debt, unavailable wallets, and malformed amounts', () => {
    expect(hasBetFunds('-1000.000000', '1000')).toBe(false)
    expect(hasBetFunds(undefined, '1000')).toBe(false)
    expect(hasBetFunds('invalid', '1000')).toBe(false)
    expect(hasBetFunds('1000.000000', '-1000')).toBe(false)
  })
})

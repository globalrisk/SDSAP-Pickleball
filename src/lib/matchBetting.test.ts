import { describe, expect, it } from 'vitest'
import { canAcceptMatchOffer, hasBetFunds, matchBettingSides, matchBettingStatus } from './matchBetting'
import type { MatchWithTeams } from '../types'

const match = {
  home_team_id: 'home', away_team_id: 'away',
  status: 'scheduled', live_status: 'available', betting_closed_at: null,
  home_pool_player_ids: ['h1', 'h2'], away_pool_player_ids: ['a1', 'a2'],
  home_team: { players: [{ pool_player_id: 'h1' }, { pool_player_id: 'bench' }] },
  away_team: { players: [{ pool_player_id: 'a1' }] },
} as MatchWithTeams

describe('match betting eligibility', () => {
  it('allows participants to back their own pair and spectators to back either pair', () => {
    expect(matchBettingStatus(match)).toBe('open')
    expect(matchBettingSides(match, 'h2')).toEqual(['home'])
    expect(matchBettingSides(match, 'a2')).toEqual(['away'])
    expect(matchBettingSides(match, 'bench')).toEqual(['home', 'away'])
    expect(matchBettingSides(match)).toEqual(['home', 'away'])
  })
  it('keeps betting closed when a previously started match returns to the queue', () => {
    expect(matchBettingStatus({ ...match, betting_closed_at: '2026-10-13T00:00:00Z' })).toBe('closed')
    expect(matchBettingStatus({ ...match, live_status: 'playing' })).toBe('closed')
    expect(matchBettingStatus({ ...match, status: 'completed' })).toBe('closed')
    expect(matchBettingStatus({ ...match, status: 'forfeit' })).toBe('closed')
  })
  it('uses current pair identities when a legacy match has no lineup snapshot', () => {
    expect(matchBettingSides({ ...match, home_pool_player_ids: null }, 'bench')).toEqual(['home'])
  })
  it('allows participants to accept only offers backing the other pair', () => {
    expect(canAcceptMatchOffer(match, 'away', 'h2')).toBe(true)
    expect(canAcceptMatchOffer(match, 'home', 'h2')).toBe(false)
    expect(canAcceptMatchOffer(match, 'home', 'a2')).toBe(true)
    expect(canAcceptMatchOffer(match, 'away', 'a2')).toBe(false)
    expect(canAcceptMatchOffer(match, 'home', 'bench')).toBe(true)
    expect(canAcceptMatchOffer(match, 'away', 'bench')).toBe(true)
  })
  it('does not accept offers with a missing match, invalid side, or closed betting', () => {
    expect(canAcceptMatchOffer(undefined, 'away', 'h2')).toBe(false)
    expect(canAcceptMatchOffer(match, 'other', 'h2')).toBe(false)
    expect(canAcceptMatchOffer({ ...match, betting_closed_at: '2026-10-13T00:00:00Z' }, 'away', 'h2')).toBe(false)
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

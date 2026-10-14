import { describe, expect, it } from 'vitest'
import { profileReturnTo, profileTab, ratingChanges, selectedSeasonStats, totalPrizes } from './myProfile'
import type { MatchWithTeams, PlayerProfile, RatingHistoryPoint } from '../types'
import type { PickleTransaction } from './betsApi'

function match(id: string, overrides: Partial<MatchWithTeams> = {}): MatchWithTeams {
  return {
    id, season_id: 's1', home_team_id: 'home', away_team_id: 'away',
    status: 'completed', live_status: 'available', live_court_number: null,
    home_score: 11, away_score: 7, winner_team_id: 'home', round_number: 1,
    home_pool_player_ids: ['a', 'b'], away_pool_player_ids: ['c', 'd'],
    result_recorded_at: id, created_at: '', winner: null,
    home_team: { id: 'home', name: 'Home', color: '', players: [{ name: 'A', pool_player_id: 'a', is_present: true }] },
    away_team: { id: 'away', name: 'Away', color: '' }, ...overrides,
  }
}
function point(sequence: number, rating: number, matchId: string | null): RatingHistoryPoint {
  return { id: String(sequence), sequence, rating, matchId, ratingDeviation: 100, seasonId: matchId === 'old' ? 's0' : 's1', seasonName: '', seasonStartsAt: null, roundNumber: null, recordedAt: '', resultRecordedAt: null, result: matchId ? 'W' : null, partnerName: null, opponentNames: [], scoreLabel: null }
}
const profile: PlayerProfile = { id: 'a', name: 'A', rating: 1540, ratingDeviation: 100, initialRating: 1500, rank: 1, provisional: false, played: 3, wins: 2, losses: 1, winRate: 2 / 3, form: ['W', 'W', 'L'], ratingDelta: 40, history: [point(0, 1500, null), point(1, 1520, 'old'), point(2, 1560, 'win'), point(3, 1540, 'loss')], funStats: { currentStreak: null, bestPartner: null, toughestOpponent: null, biggestSwing: null }, rivalries: { nemesis: null, favoriteOpponent: null, byOpponent: [] }, title: null }
const names = new Map([['a', 'A'], ['b', 'B'], ['c', 'C'], ['d', 'D']])

describe('Personal profile navigation and stats', () => {
  it('restricts login return destinations to this league’s exact hub', () => {
    expect(profileReturnTo('/leagues/sdsap/me?tab=settings', '/leagues/sdsap')).toBe('/leagues/sdsap/me?tab=settings')
    for (const path of ['https://evil.test', '//evil.test', '/\\evil.test/leagues/sdsap/me', '/leagues/other/me', '/leagues/sdsap/me/extra', '/leagues/sdsap/../other/me']) expect(profileReturnTo(path, '/leagues/sdsap')).toBeNull()
    expect(profileTab('unknown')).toBe('overview')
  })
  it('excludes forfeits, other seasons and substituted players; retains the true baseline', () => {
    const view = selectedSeasonStats(profile, 's1', [match('win'), match('loss', { winner_team_id: 'away' }), match('forfeit', { status: 'forfeit' }), match('old', { season_id: 's0' }), match('sub', { home_pool_player_ids: ['e', 'b'] })], names, 'Season one')
    expect(view).toMatchObject({ played: 2, wins: 1, losses: 1, winRate: 0.5, ratingDelta: 20, forfeits: 1, form: ['L', 'W'] })
    expect(view.history.map(row => [row.rating, row.matchId])).toEqual([[1520, null], [1560, 'win'], [1540, 'loss']])
    expect(view.funStats.biggestSwing?.delta).toBe(40)
    expect(view.funStats.bestPartner).toEqual({ name: 'B', played: 2, wins: 1 })
    expect(view.rivalries.byOpponent).toHaveLength(2)
    expect(view.rivalries.byOpponent[0]).toMatchObject({ wins: 1, losses: 1 })
    expect(profile.history[1]?.matchId).toBe('old')
  })
  it('does not invent a season change when a baseline or a result history entry is absent', () => {
    expect(selectedSeasonStats({ ...profile, history: profile.history.slice(2) }, 's1', [match('win'), match('loss')], names, 'Season').ratingDelta).toBeNull()
    expect(selectedSeasonStats(profile, 's1', [match('win'), match('missing')], names, 'Season').ratingDelta).toBeNull()
    expect(selectedSeasonStats(profile, 's1', [], names, 'Season').ratingDelta).toBe(0)
    expect(ratingChanges([...profile.history].reverse()).get('win')).toBe(40)
  })
  it('sums prize ledger entries exactly, including signed and very large values', () => {
    const history = [{ kind: 'prize', amount: '9007199254740993.123456' }, { kind: 'prize', amount: '-0.123455' }, { kind: 'bet', amount: '7000' }, { kind: 'reversal', amount: '-7000' }] as PickleTransaction[]
    expect(totalPrizes(history)).toBe('9007199254740993.000001')
    expect(totalPrizes([{ kind: 'prize', amount: '-0.000001' }] as PickleTransaction[])).toBe('-0.000001')
    expect(totalPrizes([])).toBe('0.000000')
  })
})

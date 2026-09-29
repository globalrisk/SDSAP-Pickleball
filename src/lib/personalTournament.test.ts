import { describe, expect, it } from 'vitest'
import { buildPersonalTournament } from './personalTournament'
import type { MatchWithTeams, RatingHistoryPoint } from '../types'

function match(id: string, overrides: Partial<MatchWithTeams> = {}): MatchWithTeams {
  return {
    id, season_id: 's1', home_team_id: 'home', away_team_id: 'away',
    status: 'completed', live_status: 'available', live_court_number: null,
    home_score: 11, away_score: 7, winner_team_id: 'home', round_number: 1,
    home_pool_player_ids: ['a', 'b'], away_pool_player_ids: ['c', 'd'],
    result_recorded_at: null, created_at: '', winner: null,
    home_team: { id: 'home', name: 'Home', color: '', players: [{ name: 'A', pool_player_id: 'a', is_present: true }, { name: 'B', pool_player_id: 'b', is_present: true }] },
    away_team: { id: 'away', name: 'Away', color: '', players: [{ name: 'C', pool_player_id: 'c', is_present: true }, { name: 'D', pool_player_id: 'd', is_present: true }] },
    ...overrides,
  }
}

function point(sequence: number, rating: number, matchId: string | null): RatingHistoryPoint {
  return {
    id: String(sequence), sequence, rating, matchId, ratingDeviation: 100,
    seasonId: 's1', seasonName: '', seasonStartsAt: null, roundNumber: null,
    recordedAt: '', resultRecordedAt: null, result: matchId ? 'W' : null,
    partnerName: null, opponentNames: [], scoreLabel: null,
  }
}

describe('personal tournament view', () => {
  it('uses actual lineups, ignores other tournaments and excludes forfeits from rated records', () => {
    const view = buildPersonalTournament('a', 's1', [
      match('win'), match('loss', { winner_team_id: 'away' }),
      match('forfeit', { status: 'forfeit' }), match('other-season', { season_id: 's2' }),
      match('substitute', { home_pool_player_ids: ['e', 'b'] }),
    ], [])
    expect(view).toMatchObject({ wins: 1, losses: 1, played: 2, forfeits: 1, remaining: 0 })
    expect(view.results.map((item) => item.id).sort()).toEqual(['forfeit', 'loss', 'win'])
  })

  it('shows the actual court assignment while retaining every remaining matchup', () => {
    const view = buildPersonalTournament('a', 's1', [
      match('earlier', { status: 'scheduled' }),
      match('playing', { status: 'scheduled', live_status: 'playing', live_court_number: 2, round_number: 3 }),
    ], [])
    expect(view.playingMatch?.id).toBe('playing')
    expect(view.playingMatch?.live_court_number).toBe(2)
    expect(view.remainingMatches.map((item) => item.id)).toEqual(['earlier', 'playing'])
    expect(view.remaining).toBe(2)
  })

  it('shows only the live queue assignment and does not call a blocked fixture up next', () => {
    const queued = match('queued', { status: 'scheduled', live_status: 'up_next', round_number: 4 })
    expect(buildPersonalTournament('a', 's1', [match('earlier', { status: 'scheduled' }), queued], []).upNextMatch?.id).toBe('queued')
    queued.home_team.players![0]!.is_present = false
    const blocked = buildPersonalTournament('a', 's1', [queued], [])
    expect(blocked.upNextMatch).toBeNull()
    expect(blocked.remainingMatches[0]?.id).toBe('queued')
  })

  it('does not infer a next match from round numbers or input order', () => {
    const fixtures = [match('round-five', { status: 'scheduled', round_number: 5 }), match('round-one', { status: 'scheduled', round_number: 1 })]
    for (const matches of [fixtures, [...fixtures].reverse()]) {
      const view = buildPersonalTournament('a', 's1', matches, [])
      expect(view.playingMatch).toBeNull()
      expect(view.upNextMatch).toBeNull()
      expect(new Set(view.remainingMatches.map((item) => item.id))).toEqual(new Set(['round-five', 'round-one']))
    }
  })

  it('does not borrow another player\'s court or queue assignment', () => {
    const view = buildPersonalTournament('a', 's1', [
      match('mine', { status: 'scheduled' }),
      match('other-playing', { status: 'scheduled', live_status: 'playing', home_pool_player_ids: ['e', 'f'] }),
      match('other-queued', { status: 'scheduled', live_status: 'up_next', home_pool_player_ids: ['e', 'f'] }),
    ], [])
    expect(view.playingMatch).toBeNull()
    expect(view.upNextMatch).toBeNull()
    expect(view.remainingMatches.map((item) => item.id)).toEqual(['mine'])
  })

  it('calculates the selected tournament change without leaking later rating gains', () => {
    const history = [point(0, 1800, null), point(1, 1400, 'earlier-season'), point(2, 1440, 'win'), point(3, 1420, 'loss'), point(4, 1700, 'future-season')]
    const view = buildPersonalTournament('a', 's1', [match('win'), match('loss', { winner_team_id: 'away' })], history.reverse())
    expect(view.ratingDelta).toBe(20)
    expect(view.endingRating).toBe(1420)
  })

  it('shows an unavailable change when history is incomplete instead of a misleading value', () => {
    const view = buildPersonalTournament('a', 's1', [match('one'), match('two')], [point(0, 1500, null), point(1, 1520, 'one')])
    expect(view.ratingDelta).toBeNull()
    expect(view.endingRating).toBeNull()
  })

  it('handles a player with no fixtures and a new player with no results', () => {
    expect(buildPersonalTournament('absent', 's1', [match('one')], []).hasFixtures).toBe(false)
    expect(buildPersonalTournament('a', 's1', [match('one', { status: 'scheduled' })], [])).toMatchObject({ ratingDelta: 0, played: 0, remaining: 1 })
  })
})

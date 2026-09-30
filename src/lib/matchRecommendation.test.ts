import { describe, expect, it } from 'vitest'
import { rankAvailableMatches, recommendNextMatch } from './matchRecommendation'
import type { MatchLiveStatus, MatchStatus, MatchWithTeams, StandingRow, Team } from '../types'

function match(
  id: string,
  home: string,
  away: string,
  options: {
    status?: MatchStatus
    liveStatus?: MatchLiveStatus
    recordedAt?: string
    absentHome?: boolean
    round?: number
  } = {},
): MatchWithTeams {
  const team = (teamId: string, absent = false) => ({
    id: teamId,
    name: teamId,
    color: '#15803d',
    players: [
      { name: `${teamId}1`, pool_player_id: `${teamId}1`, is_present: !absent },
      { name: `${teamId}2`, pool_player_id: `${teamId}2`, is_present: true },
    ],
  })
  return {
    id,
    season_id: 'season',
    home_team_id: home,
    away_team_id: away,
    status: options.status ?? 'scheduled',
    live_status: options.liveStatus ?? 'available',
    live_court_number: options.liveStatus === 'playing' ? 1 : null,
    home_score: null,
    away_score: null,
    winner_team_id: options.status === 'completed' ? home : null,
    round_number: options.round ?? 1,
    home_pool_player_ids: null,
    away_pool_player_ids: null,
    result_recorded_at: options.recordedAt ?? null,
    created_at: '',
    home_team: team(home, options.absentHome),
    away_team: team(away),
    winner: null,
  }
}

function standing(teamId: string, played: number, points = 0, rank = 1): StandingRow {
  return {
    rank,
    team: { id: teamId, season_id: 'season', name: teamId, color: '', created_at: '' } as Team,
    playerNames: [],
    players: [],
    played,
    wins: points,
    losses: played - points,
    points,
  }
}

describe('recommendNextMatch', () => {
  it('reorders the full queue after a match is played out of round order', () => {
    const matches = [
      match('random', 'A', 'B', { status: 'completed', recordedAt: '2026-08-14T01:00:00Z', round: 5 }),
      match('old-round', 'A', 'C', { round: 1 }),
      match('fair-first', 'D', 'E', { round: 7 }),
      match('fair-second', 'C', 'F', { round: 2 }),
    ]

    expect(rankAvailableMatches(matches, [])?.map((item) => item.id)).toEqual([
      'fair-second', 'fair-first', 'old-round',
    ])
  })

  it('plans rest across the displayed queue instead of ranking each match in isolation', () => {
    const matches = [
      match('first', 'A', 'B', { round: 1 }),
      match('same-team', 'A', 'C', { round: 2 }),
      match('rested', 'C', 'D', { round: 3 }),
    ]

    expect(rankAvailableMatches(matches, []).map((item) => item.id)).toEqual([
      'first', 'rested', 'same-team',
    ])
  })

  it('plans the available order after an explicitly queued match', () => {
    const matches = [
      match('queued', 'A', 'B', { liveStatus: 'up_next', round: 5 }),
      match('same-team', 'A', 'C', { round: 1 }),
      match('rested', 'C', 'D', { round: 2 }),
    ]

    expect(rankAvailableMatches(matches, []).map((item) => item.id)).toEqual([
      'rested', 'same-team',
    ])
  })

  it('does not offer a team on court and accounts for its pending game', () => {
    const matches = [
      match('on-court', 'A', 'B', { liveStatus: 'playing' }),
      match('blocked', 'A', 'C', { round: 1 }),
      match('ready', 'C', 'D', { round: 2 }),
    ]

    expect(rankAvailableMatches(matches, []).map((item) => item.id)).toEqual(['ready'])
  })

  it('ignores a stale queued match that shares a team with Court 1', () => {
    const matches = [
      match('court-1', 'A', 'B', { liveStatus: 'playing' }),
      match('stale-queue', 'A', 'C', { liveStatus: 'up_next' }),
      match('court-2-first', 'C', 'D', { round: 1 }),
      match('court-2-later', 'E', 'F', { round: 2 }),
    ]

    expect(rankAvailableMatches(matches, [])[0]?.id).toBe('court-2-first')
  })

  it('prioritizes equal match counts before other preferences', () => {
    const matches = [
      match('played', 'A', 'B', { status: 'completed', recordedAt: '2026-08-14T01:00:00Z' }),
      match('uneven', 'A', 'B'),
      match('balanced', 'C', 'D'),
    ]

    expect(recommendNextMatch(matches, [
      standing('A', 1), standing('B', 1), standing('C', 0), standing('D', 0),
    ])?.id).toBe('balanced')
  })

  it('avoids teams that just played when fairness is equal', () => {
    const matches = [
      match('older', 'C', 'D', { status: 'completed', recordedAt: '2026-08-14T01:00:00Z' }),
      match('latest', 'A', 'B', { status: 'completed', recordedAt: '2026-08-14T02:00:00Z' }),
      match('less-rest', 'A', 'C'),
      match('more-rest', 'C', 'D'),
    ]

    expect(recommendNextMatch(matches, [])?.id).toBe('more-rest')
  })

  it('excludes unavailable players and avoids teams already on court', () => {
    const matches = [
      match('playing', 'A', 'B', { liveStatus: 'playing' }),
      match('shares-court', 'A', 'C'),
      match('absent', 'D', 'E', { absentHome: true }),
      match('eligible', 'D', 'F'),
    ]

    expect(recommendNextMatch(matches, [])?.id).toBe('eligible')
  })

  it('returns no recommendation when every ready match uses a team on court', () => {
    const matches = [
      match('playing', 'A', 'B', { liveStatus: 'playing' }),
      match('shares-home', 'A', 'C'),
      match('shares-away', 'D', 'B'),
    ]

    expect(recommendNextMatch(matches, [])).toBeNull()
  })
})

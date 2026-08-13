import { describe, expect, it } from 'vitest'
import type { MatchStatus, MatchWithTeams, TeamWithPlayers } from '../types'
import { computeStandings } from './standings'

function makeTeam(id: string): TeamWithPlayers {
  return {
    id,
    season_id: 'season',
    name: id,
    color: '#000000',
    created_at: '2026-01-01T00:00:00Z',
    players: [],
  }
}

let matchSequence = 0

function makeMatch(
  homeId: string,
  awayId: string,
  winnerId: string | null,
  status: MatchStatus = 'completed',
  score?: [number, number],
): MatchWithTeams {
  matchSequence += 1
  return {
    id: `match-${matchSequence}`,
    season_id: 'season',
    home_team_id: homeId,
    away_team_id: awayId,
    status,
    live_status: 'available',
    live_court_number: null,
    home_score: score?.[0] ?? null,
    away_score: score?.[1] ?? null,
    winner_team_id: winnerId,
    round_number: matchSequence,
    home_pool_player_ids: null,
    away_pool_player_ids: null,
    result_recorded_at: status === 'scheduled' ? null : '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    home_team: { id: homeId, name: homeId, color: '#000000' },
    away_team: { id: awayId, name: awayId, color: '#000000' },
    winner: winnerId ? { id: winnerId, name: winnerId, color: '#000000' } : null,
  }
}

function result(teamIds: string[], matches: MatchWithTeams[]) {
  return computeStandings(teamIds.map(makeTeam), matches).map((row) => ({
    id: row.team.id,
    rank: row.rank,
    points: row.points,
  }))
}

describe('computeStandings', () => {
  it('orders teams by points when there is no tie', () => {
    const matches = [makeMatch('A', 'B', 'A'), makeMatch('A', 'C', 'A'), makeMatch('B', 'C', 'B')]

    expect(result(['A', 'B', 'C'], matches)).toEqual([
      { id: 'A', rank: 1, points: 2 },
      { id: 'B', rank: 2, points: 1 },
      { id: 'C', rank: 3, points: 0 },
    ])
  })

  it('uses the direct result for a two-team tie', () => {
    const matches = [makeMatch('A', 'B', 'A'), makeMatch('B', 'C', 'B')]

    expect(result(['A', 'B', 'C'], matches)).toEqual([
      { id: 'A', rank: 1, points: 1 },
      { id: 'B', rank: 2, points: 1 },
      { id: 'C', rank: 3, points: 0 },
    ])
  })

  it('shares rank when two tied teams have not played', () => {
    const matches = [makeMatch('A', 'C', 'A'), makeMatch('B', 'C', 'B')]

    expect(result(['C', 'B', 'A'], matches)).toEqual([
      { id: 'A', rank: 1, points: 1 },
      { id: 'B', rank: 1, points: 1 },
      { id: 'C', rank: 3, points: 0 },
    ])
  })

  it('resolves a transitive three-team mini-table', () => {
    const matches = [
      makeMatch('A', 'B', 'A'),
      makeMatch('A', 'C', 'A'),
      makeMatch('B', 'C', 'B'),
      makeMatch('B', 'D', 'B'),
      makeMatch('C', 'D', 'C'),
      makeMatch('C', 'E', 'C'),
    ]

    expect(result(['A', 'B', 'C', 'D', 'E'], matches).slice(0, 3)).toEqual([
      { id: 'A', rank: 1, points: 2 },
      { id: 'B', rank: 2, points: 2 },
      { id: 'C', rank: 3, points: 2 },
    ])
  })

  it('shares rank for a circular three-team tie', () => {
    const matches = [
      makeMatch('A', 'B', 'A'),
      makeMatch('B', 'C', 'B'),
      makeMatch('C', 'A', 'C'),
    ]

    expect(result(['C', 'A', 'B'], matches)).toEqual([
      { id: 'A', rank: 1, points: 1 },
      { id: 'B', rank: 1, points: 1 },
      { id: 'C', rank: 1, points: 1 },
    ])
  })

  it('breaks a circular three-team tie by tied-group point differential', () => {
    const matches = [
      makeMatch('A', 'B', 'A', 'completed', [11, 5]),
      makeMatch('B', 'C', 'B', 'completed', [11, 4]),
      makeMatch('C', 'A', 'C', 'completed', [11, 5]),
    ]

    expect(result(['C', 'A', 'B'], matches)).toEqual([
      { id: 'B', rank: 1, points: 1 },
      { id: 'A', rank: 2, points: 1 },
      { id: 'C', rank: 3, points: 1 },
    ])
  })

  it('uses finished partial results and preserves competition rank gaps', () => {
    const matches = [
      makeMatch('A', 'B', 'A'),
      makeMatch('B', 'D', 'B'),
      makeMatch('C', 'D', 'C'),
    ]

    expect(result(['A', 'B', 'C', 'D'], matches)).toEqual([
      { id: 'A', rank: 1, points: 1 },
      { id: 'B', rank: 2, points: 1 },
      { id: 'C', rank: 2, points: 1 },
      { id: 'D', rank: 4, points: 0 },
    ])
  })

  it('recursively resolves tied subgroups within a four-team tie', () => {
    const matches = [
      makeMatch('A', 'B', 'A'),
      makeMatch('A', 'C', 'A'),
      makeMatch('D', 'A', 'D'),
      makeMatch('B', 'C', 'B'),
      makeMatch('B', 'D', 'B'),
      makeMatch('C', 'D', 'C'),
      makeMatch('A', 'X', 'A'),
      makeMatch('B', 'X', 'B'),
      makeMatch('C', 'X', 'C'),
      makeMatch('C', 'Y', 'C'),
      makeMatch('D', 'X', 'D'),
      makeMatch('D', 'Y', 'D'),
    ]

    expect(result(['D', 'C', 'B', 'A', 'X', 'Y'], matches).slice(0, 4)).toEqual([
      { id: 'A', rank: 1, points: 3 },
      { id: 'B', rank: 2, points: 3 },
      { id: 'C', rank: 3, points: 3 },
      { id: 'D', rank: 4, points: 3 },
    ])
  })

  it('can leave a circular subgroup tied within a four-team points tie', () => {
    const matches = [
      makeMatch('A', 'B', 'A'),
      makeMatch('B', 'C', 'B'),
      makeMatch('C', 'A', 'C'),
      makeMatch('D', 'X', 'D'),
    ]

    expect(result(['D', 'C', 'B', 'A', 'X'], matches)).toEqual([
      { id: 'A', rank: 1, points: 1 },
      { id: 'B', rank: 1, points: 1 },
      { id: 'C', rank: 1, points: 1 },
      { id: 'D', rank: 4, points: 1 },
      { id: 'X', rank: 5, points: 0 },
    ])
  })

  it('counts forfeits and ignores scheduled matches', () => {
    const matches = [
      makeMatch('A', 'B', 'A', 'forfeit'),
      makeMatch('B', 'C', 'B', 'scheduled'),
    ]

    expect(result(['A', 'B', 'C'], matches)).toEqual([
      { id: 'A', rank: 1, points: 1 },
      { id: 'B', rank: 2, points: 0 },
      { id: 'C', rank: 2, points: 0 },
    ])
  })

  it('is invariant to input order for circular ties', () => {
    const matches = [
      makeMatch('A', 'B', 'A'),
      makeMatch('B', 'C', 'B'),
      makeMatch('C', 'A', 'C'),
    ]

    expect(result(['A', 'B', 'C'], matches)).toEqual(result(['C', 'A', 'B'], matches))
  })
})

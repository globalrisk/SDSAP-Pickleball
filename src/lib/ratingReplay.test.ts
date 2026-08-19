import { describe, expect, it } from 'vitest'
import { replayRatings, type FinishedMatchForRatings } from './ratingReplay'

function match(overrides: Partial<FinishedMatchForRatings> = {}): FinishedMatchForRatings {
  return {
    id: 'm1',
    season_id: 's1',
    season_starts_at: '2025-01-01',
    result_recorded_at: '2025-01-02',
    winner_team_id: 'home',
    home_team_id: 'home',
    away_team_id: 'away',
    home_score: 11,
    away_score: 8,
    home_pool_player_ids: ['a', 'b'],
    away_pool_player_ids: ['c', 'd'],
    home_players: [],
    away_players: [],
    ...overrides,
  }
}

describe('canonical rating replay', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, initial_rating: 1500 }))

  it('is deterministic for the same normalized match history', () => {
    const input = {
      pool,
      finishedMatches: [match()],
      seasonRosters: new Map([['s1', ['a', 'b', 'c', 'd']]]),
      recordedAt: '2025-01-03',
    }
    expect(replayRatings(input)).toEqual(replayRatings(input))
  })

  it('increases uncertainty for a previously rated player who skips a season', () => {
    const result = replayRatings({
      pool,
      finishedMatches: [
        match(),
        match({
          id: 'm2',
          season_id: 's2',
          season_starts_at: '2026-01-01',
          result_recorded_at: '2026-01-02',
          home_pool_player_ids: ['b', 'c'],
          away_pool_player_ids: ['d', 'e'],
        }),
      ],
      seasonRosters: new Map([
        ['s1', ['a', 'b', 'c', 'd']],
        ['s2', ['b', 'c', 'd', 'e']],
      ]),
      recordedAt: '2026-01-03',
    })
    const aHistory = result.historyRows.filter((row) => row.pool_player_id === 'a')
    expect(aHistory).toHaveLength(3)
    expect(aHistory[2]!.rating_deviation).toBeGreaterThan(aHistory[1]!.rating_deviation)
  })
})

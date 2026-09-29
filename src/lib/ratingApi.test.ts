import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TitlePlayerStats } from './playerTitles'

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  revision: 0,
  overlap: false,
  calls: [] as Record<string, unknown>[],
  titleStats: [] as unknown[],
}))

vi.mock('./supabase', () => ({
  supabase: {
    from(table: string) {
      let from = 0
      let to = 499
      const query = {
        select() { return query }, eq() { return query }, not() { return query }, order() { return query },
        single() { return query }, range(start: number, end: number) { from = start; to = end; return query },
        then(resolve: (value: unknown) => unknown) {
          const data = table === 'rating_state'
            ? { revision: state.revision }
            : [...(state.tables[table] ?? [])].slice(from, to + 1)
          if (table === 'matches' && from === 0 && state.overlap) {
            state.overlap = false
            state.tables.matches.push({ ...state.tables.matches[0], id: 'other-result' })
            state.revision += 1
          }
          return Promise.resolve(resolve({ data, error: null }))
        },
      }
      return query
    },
    async rpc(_name: string, args: Record<string, unknown>) {
      state.calls.push(args)
      if (args.p_expected_revision !== state.revision) return { error: { code: '40001', message: 'Rating revision conflict' } }
      state.revision += 1
      return { error: null }
    },
  },
}))

vi.mock('./playerTitles', async (importOriginal) => ({
  ...await importOriginal<typeof import('./playerTitles')>(),
  assignPlayerTitles(stats: unknown[]) { state.titleStats = stats; return new Map() },
}))

import { fetchPlayerTitlesMap, recomputeAllRatings } from './api'

beforeEach(() => {
  state.revision = 0
  state.overlap = false
  state.calls = []
  state.titleStats = []
  state.tables = {
    league_players: ['a', 'b', 'c', 'd'].map((pool_player_id, i) => ({
      pool_player_id, initial_rating: i < 2 ? 1200 : 1800,
      rating: i < 2 ? 2300 : 1000, rating_deviation: 90, status: 'active',
      player_pool: { id: pool_player_id, name: pool_player_id, created_at: '' },
    })),
    matches: [{
      id: 'first', season_id: 'season', status: 'completed',
      home_team_id: 'home', away_team_id: 'away', winner_team_id: 'home', home_score: 11, away_score: 7,
      home_pool_player_ids: ['a', 'b'], away_pool_player_ids: ['c', 'd'],
      result_recorded_at: '2026-09-01T12:00:00Z', seasons: { starts_at: '2026-09-01T00:00:00Z' },
      home_team: { players: [] }, away_team: { players: [] },
    }],
    rating_history: [], teams: [], seasons: [], players: [],
  }
  const pool = state.tables.league_players
  state.tables.rating_history = [
    ...pool.map((p, sequence) => ({ id: `seed-${sequence}`, pool_player_id: p.pool_player_id, match_id: null, sequence, rating: p.initial_rating, rating_deviation: 275 })),
    ...pool.map((p, i) => ({ id: `post-${i}`, pool_player_id: p.pool_player_id, match_id: 'first', sequence: i + 4, rating: p.rating, rating_deviation: 90 })),
  ]
})

describe('rating API regressions', () => {
  it('provides played tournament metadata for recent badge calculations', async () => {
    state.tables.seasons = [{ id: 'season', name: 'September Cup', starts_at: '2026-09-01', status: 'active' }]
    await fetchPlayerTitlesMap('league')
    const player = (state.titleStats as TitlePlayerStats[]).find((p) => p.id === 'a')!
    expect(player.recentSeasonsPlayed).toBe(1)
    expect(player.recentMatchesPlayed).toBe(1)
    expect(player.matchesBeforeRecentWindow).toBe(0)
  })

  it('classifies a past upset from pre-match evidence even when the winners are now favorites', async () => {
    await fetchPlayerTitlesMap('league')
    expect((state.titleStats as TitlePlayerStats[]).find((p) => p.id === 'a')!.underdogWins).toBe(1)
    state.tables.league_players[0].rating = 2500
    state.tables.rating_history.push({ id: 'future', pool_player_id: 'a', match_id: 'later', sequence: 8, rating: 2500, rating_deviation: 70 })
    await fetchPlayerTitlesMap('league')
    expect((state.titleStats as TitlePlayerStats[]).find((p) => p.id === 'a')!.underdogWins).toBe(1)
  })

  it('retries an overlapping commit with both saved results included in the replacement', async () => {
    state.overlap = true
    await recomputeAllRatings('league')
    expect(state.calls).toHaveLength(2)
    expect(state.calls[0].p_expected_revision).toBe(0)
    expect(state.calls[1].p_expected_revision).toBe(1)
    const history = state.calls[1].p_history_rows as { match_id: string | null }[]
    expect(new Set(history.map((row) => row.match_id).filter(Boolean))).toEqual(new Set(['first', 'other-result']))
  })
})

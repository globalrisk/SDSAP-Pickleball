import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { buildRatingsReplacement } from './ratingRepository'

const match = {
  id: 'match', status: 'completed', season_id: 'season', result_recorded_at: '2026-09-01T12:00:00Z',
  winner_team_id: 'home', home_team_id: 'home', away_team_id: 'away', home_score: 11, away_score: 7,
  home_pool_player_ids: ['a', 'b'], away_pool_player_ids: ['c', 'd'],
  home_team: { players: [] }, away_team: { players: [] }, seasons: { starts_at: '2026-09-01T00:00:00Z' },
}

function fakeDb(onRead: (table: string) => void = () => {}) {
  let revision = 4
  const pool = ['a', 'b', 'c', 'd'].map((pool_player_id) => ({ pool_player_id, initial_rating: 1500 }))
  const reads: string[] = []
  const db = {
    from(table: string) {
      let from = 0
      let to = 499
      const query = {
        select() { return query }, eq() { return query }, order() { return query },
        range(start: number, end: number) { from = start; to = end; return query },
        single() { return query },
        then(resolve: (value: unknown) => unknown) {
          reads.push(table)
          const rows = table === 'league_players' ? pool : table === 'matches' ? [match] : pool
          const data = table === 'rating_state' ? { revision } : rows.slice(from, to + 1)
          onRead(table)
          if (table === 'matches') revision += 1 // Another admin commits after this match snapshot.
          return Promise.resolve(resolve({ data, error: null }))
        },
      }
      return query
    },
  } as unknown as SupabaseClient
  return { db, reads, currentRevision: () => revision }
}

describe('rating replay snapshot', () => {
  it('keeps the earlier revision so an overlapping commit cannot pass the save check', async () => {
    const state = fakeDb()
    const replacement = await buildRatingsReplacement(state.db, 'league')
    expect(state.reads[0]).toBe('rating_state')
    expect(replacement.expectedRevision).toBe(4)
    expect(replacement.expectedRevision).not.toBe(state.currentRevision())
    expect(replacement.historyRows.filter((row) => row.match_id === 'match')).toHaveLength(4)
  })

  it('includes an unsaved result and excludes a reverted result before the atomic save', async () => {
    const state = fakeDb()
    const included = await buildRatingsReplacement(state.db, 'league', {
      matchId: 'match', mode: 'completed', winnerTeamId: 'away', homePoolPlayerIds: ['a', 'b'], awayPoolPlayerIds: ['c', 'd'],
    })
    expect(included.playerRatings.find((row) => row.id === 'c')!.rating).toBeGreaterThan(1500)
    const excluded = await buildRatingsReplacement(state.db, 'league', { matchId: 'match', mode: 'exclude' })
    expect(excluded.historyRows).toHaveLength(4)
    expect(excluded.playerRatings.every((row) => Math.abs(row.rating_deviation - 275) < 1e-8)).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { replayRatings, type FinishedMatchForRatings } from './ratingReplay'
import { buildPreMatchRatings } from './historicalRatings'
import { applyDoublesMatchToRatings, createInitialRatingsMap } from './ratings'

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
      recordedAt: '2025-01-03',
    }
    expect(replayRatings(input)).toEqual(replayRatings(input))
  })

  it('records absence growth without changing an absent player’s mean or an unrated seed', () => {
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
      recordedAt: '2026-01-03',
    })
    const aHistory = result.historyRows.filter((row) => row.pool_player_id === 'a')
    expect(aHistory).toHaveLength(3)
    expect(aHistory[2]!.rating_deviation).toBeGreaterThan(aHistory[1]!.rating_deviation)
    expect(aHistory[2]!.rating).toBe(aHistory[1]!.rating)
  })

  it('uses elapsed game dates within the same season and exposes returning pre-match uncertainty', () => {
    const first = match({ result_recorded_at: '2026-01-01T12:00:00Z' })
    const second = match({ id: 'm2', result_recorded_at: '2026-01-29T12:00:00Z' })
    const result = replayRatings({ pool, finishedMatches: [first, second], recordedAt: '2026-02-01' })
    const before = buildPreMatchRatings(result.historyRows)
    const afterFirst = result.historyRows.find((r) => r.pool_player_id === 'a' && r.match_id === 'm1')!
    // Four weeks between games minus one week's grace = three idle weeks.
    expect(before.get('m2:a')!.rd).toBeCloseTo(Math.sqrt(afterFirst.rating_deviation ** 2 + 25 ** 2 * 3), 12)
    const expected = createInitialRatingsMap(pool)
    applyDoublesMatchToRatings(expected, { winnerPoolIds: ['a', 'b'], loserPoolIds: ['c', 'd'] })
    for (const id of ['a', 'b', 'c', 'd']) {
      const rating = expected.get(id)!
      expected.set(id, { ...rating, rd: Math.sqrt(rating.rd ** 2 + 25 ** 2 * 3) })
    }
    applyDoublesMatchToRatings(expected, { winnerPoolIds: ['a', 'b'], loserPoolIds: ['c', 'd'] })
    expect(result.playerRatings.find((p) => p.id === 'a')!.rating).toBeCloseTo(expected.get('a')!.rating, 12)
    expect(result.playerRatings.find((p) => p.id === 'e')!.rating_deviation).toBeCloseTo(275, 12)
  })

  it('keeps weekly play identical to normal match updates despite season changes and entry-hour jitter', () => {
    const games = [match({ result_recorded_at: '2026-01-01T12:00:00Z' }), match({
      id: 'm2', season_id: 's2', result_recorded_at: '2026-01-08T15:00:00Z',
    })]
    const result = replayRatings({ pool, finishedMatches: games, recordedAt: '2026-01-08', asOf: '2026-01-08' })
    const expected = createInitialRatingsMap(pool)
    for (const _game of games) applyDoublesMatchToRatings(expected, { winnerPoolIds: ['a', 'b'], loserPoolIds: ['c', 'd'] })
    expect(result.playerRatings.map(p => p.rating_deviation)).toEqual(pool.map(p => expected.get(p.id)!.rd))
    expect(result.historyRows).toHaveLength(pool.length + games.length * 4)
  })

  it('ages through an explicit rebuild date without affecting earlier predictions or double charging', () => {
    const games = [match({ result_recorded_at: '2026-01-01' })]
    const earlier = replayRatings({ pool, finishedMatches: games, recordedAt: '2026-01-01' })
    const input = { pool, finishedMatches: games, recordedAt: '2026-01-29', asOf: '2026-01-29' }
    const aged = replayRatings(input)
    expect(replayRatings(input)).toEqual(aged)
    expect(buildPreMatchRatings(aged.historyRows)).toEqual(buildPreMatchRatings(earlier.historyRows))
    const previous = earlier.playerRatings.find(p => p.id === 'a')!
    expect(aged.playerRatings.find(p => p.id === 'a')!.rating_deviation).toBeCloseTo(Math.sqrt(previous.rating_deviation ** 2 + 25 ** 2 * 3), 12)
    expect(aged.playerRatings.find(p => p.id === 'a')!.rating).toBe(previous.rating)
  })

  it('uses a valid season date for legacy results and ignores unresolvable dates', () => {
    const first = match({ result_recorded_at: null, season_starts_at: '2026-01-01' })
    const result = replayRatings({ pool, finishedMatches: [first], recordedAt: '2026-01-29', asOf: '2026-01-29' })
    expect(result.historyRows.filter(r => r.pool_player_id === 'a')).toHaveLength(3)
    const unknown = replayRatings({ pool, finishedMatches: [match({ result_recorded_at: null, season_starts_at: '' })], recordedAt: '2026-01-29', asOf: '2026-01-29' })
    expect(unknown.historyRows.filter(r => r.pool_player_id === 'a')).toHaveLength(2)
  })

  it('skips invalid lineups without treating them as activity or an absence boundary', () => {
    const first = match({ result_recorded_at: '2026-01-01' })
    const invalid = match({ id: 'invalid', home_pool_player_ids: [], result_recorded_at: '2026-03-01' })
    const result = replayRatings({ pool, finishedMatches: [first, invalid], recordedAt: '2026-03-01' })
    expect(result).toEqual(replayRatings({ pool, finishedMatches: [first], recordedAt: '2026-03-01' }))
  })
})

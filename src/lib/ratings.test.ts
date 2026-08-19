import { describe, expect, it } from 'vitest'
import {
  applyDoublesMatchToRatings,
  buildRankingRows,
  createInitialRatingsMap,
} from './ratings'

describe('TrueSkill rating model', () => {
  it('rewards winners, penalizes losers, and ignores score margin', () => {
    const pool = ['a', 'b', 'c', 'd'].map((id) => ({ id, initial_rating: 1500 }))
    const close = createInitialRatingsMap(pool)
    const blowout = createInitialRatingsMap(pool)
    applyDoublesMatchToRatings(close, {
      winnerPoolIds: ['a', 'b'],
      loserPoolIds: ['c', 'd'],
      winnerScore: 11,
      loserScore: 10,
    })
    applyDoublesMatchToRatings(blowout, {
      winnerPoolIds: ['a', 'b'],
      loserPoolIds: ['c', 'd'],
      winnerScore: 11,
      loserScore: 0,
    })

    expect(close.get('a')!.rating).toBeGreaterThan(1500)
    expect(close.get('c')!.rating).toBeLessThan(1500)
    expect(blowout).toEqual(close)
  })
})

describe('leaderboard ordering', () => {
  it('ranks established active players by conservative score only', () => {
    const rows = buildRankingRows(
      [
        { id: 'uncertain', name: 'Uncertain', status: 'active' as const, rating: 1800, rating_deviation: 200, volatility: 0 },
        { id: 'certain', name: 'Certain', status: 'active' as const, rating: 1700, rating_deviation: 100, volatility: 0 },
        { id: 'new', name: 'New', status: 'active' as const, rating: 2000, rating_deviation: 100, volatility: 0 },
        { id: 'inactive', name: 'Inactive', status: 'inactive' as const, rating: 2200, rating_deviation: 50, volatility: 0 },
      ],
      new Map([['uncertain', 8], ['certain', 8], ['new', 4], ['inactive', 20]]),
    )

    expect(rows.map((row) => row.id)).toEqual(['certain', 'uncertain', 'new', 'inactive'])
    expect(rows.map((row) => row.rank)).toEqual([1, 2, null, null])
    expect(rows.find((row) => row.id === 'new')?.provisional).toBe(true)
  })
})

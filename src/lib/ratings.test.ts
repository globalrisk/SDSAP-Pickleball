import { describe, expect, it } from 'vitest'
import {
  applyDoublesMatchToRatings,
  buildRankingRows,
  createInitialRatingsMap,
  MIN_RATING_DEVIATION,
} from './ratings'

describe('TrueSkill rating model', () => {
  it('uses the minimum uncertainty when learning from legacy ratings below the floor', () => {
    const ids = ['a', 'b', 'c', 'd']
    const legacy = new Map(ids.map(id => [id, { rating: 1500, rd: 30, volatility: 0 }]))
    const minimum = new Map(ids.map(id => [id, { rating: 1500, rd: MIN_RATING_DEVIATION, volatility: 0 }]))
    const match = { winnerPoolIds: ['a', 'b'] as [string, string], loserPoolIds: ['c', 'd'] as [string, string] }
    applyDoublesMatchToRatings(legacy, match)
    applyDoublesMatchToRatings(minimum, match)
    expect(legacy).toEqual(minimum)
    expect(legacy.get('a')!.rating - 1500).toBeCloseTo(14.85, 2)
    expect([...legacy.values()].every(rating => rating.rd === MIN_RATING_DEVIATION)).toBe(true)
  })

  it('keeps ratings responsive after many results while retaining higher uncertainty', () => {
    const ratings = createInitialRatingsMap(['a', 'b', 'c', 'd'].map(id => ({ id, initial_rating: 1500 })))
    const match = { winnerPoolIds: ['a', 'b'] as [string, string], loserPoolIds: ['c', 'd'] as [string, string] }
    applyDoublesMatchToRatings(ratings, match)
    expect(ratings.get('a')!.rd).toBeGreaterThan(MIN_RATING_DEVIATION)
    for (let i = 0; i < 500; i++) {
      applyDoublesMatchToRatings(ratings, i % 2 ? match : { winnerPoolIds: match.loserPoolIds, loserPoolIds: match.winnerPoolIds })
      expect([...ratings.values()].every(rating => rating.rd >= MIN_RATING_DEVIATION)).toBe(true)
    }
    const before = ratings.get('a')!.rating
    applyDoublesMatchToRatings(ratings, match)
    expect(ratings.get('a')!.rating - before).toBeGreaterThan(10)
  })

  it('matches the closed-form update for a decisive result with no draw margin', () => {
    const ratings = createInitialRatingsMap(['a', 'b', 'c', 'd'].map((id) => ({ id, initial_rating: 1500 })))
    applyDoublesMatchToRatings(ratings, { winnerPoolIds: ['a', 'b'], loserPoolIds: ['c', 'd'] })
    const variance = (275 / 60) ** 2 + (25 / 300) ** 2
    const c = Math.sqrt(4 * variance + 4 * (25 / 6) ** 2)
    const expectedGain = variance / c * Math.sqrt(2 / Math.PI) * 60
    // The library approximates the Gaussian CDF; allow sub-millionth-point error.
    expect(ratings.get('a')!.rating).toBeCloseTo(1500 + expectedGain, 5)
    expect(ratings.get('c')!.rating).toBeCloseTo(1500 - expectedGain, 5)
  })

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
  it('ranks established active players by displayed rating', () => {
    const rows = buildRankingRows(
      [
        { id: 'uncertain', name: 'Uncertain', status: 'active' as const, rating: 1800, rating_deviation: 200, volatility: 0 },
        { id: 'certain', name: 'Certain', status: 'active' as const, rating: 1700, rating_deviation: 100, volatility: 0 },
        { id: 'new', name: 'New', status: 'active' as const, rating: 2000, rating_deviation: 100, volatility: 0 },
        { id: 'inactive', name: 'Inactive', status: 'inactive' as const, rating: 2200, rating_deviation: 50, volatility: 0 },
      ],
      new Map([['uncertain', 8], ['certain', 8], ['new', 4], ['inactive', 20]]),
    )

    expect(rows.map((row) => row.id)).toEqual(['uncertain', 'certain', 'new', 'inactive'])
    expect(rows.map((row) => row.rank)).toEqual([1, 2, null, null])
    expect(rows.find((row) => row.id === 'new')?.provisional).toBe(true)
  })
})

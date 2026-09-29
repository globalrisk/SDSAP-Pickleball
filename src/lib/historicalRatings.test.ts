import { describe, expect, it } from 'vitest'
import { buildPreMatchRatings, type HistoricalRatingRow } from './historicalRatings'

const row = (sequence: number, match_id: string | null, rating: number, rd = 100): HistoricalRatingRow => ({
  pool_player_id: 'a', match_id, rating, rating_deviation: rd, sequence,
})

describe('historical pre-match evidence', () => {
  it('keeps past predictions unchanged after later improvement', () => {
    const past = [row(0, null, 1200, 275), row(1, 'first', 1300), row(2, 'second', 1400)]
    const before = buildPreMatchRatings(past)
    const after = buildPreMatchRatings([...past, row(3, 'future', 2200)])
    expect(before.get('first:a')).toEqual({ rating: 1200, rd: 275 })
    expect(after.get('first:a')).toEqual(before.get('first:a'))
    expect(after.get('second:a')).toEqual({ rating: 1300, rd: 100 })
  })

  it('includes skipped-season uncertainty and orders by sequence, not response order', () => {
    const ratings = buildPreMatchRatings([row(3, 'return', 1550), row(0, null, 1500, 275), row(2, null, 1510, 175), row(1, 'first', 1510)])
    expect(ratings.get('return:a')).toEqual({ rating: 1510, rd: 175 })
  })

  it('uses the player seed when the initial history is missing', () => {
    const ratings = buildPreMatchRatings([row(1, 'first', 1400)], new Map([['a', { rating: 1300, rd: 275 }]]))
    expect(ratings.get('first:a')).toEqual({ rating: 1300, rd: 275 })
    expect(ratings.has('unrecorded:a')).toBe(false)
  })
})

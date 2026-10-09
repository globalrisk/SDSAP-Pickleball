import { describe, expect, it } from 'vitest'
import { RatingInactivityTracker, ratingActivityDate } from './ratingInactivity'
import { inactivityRatingDeviation, type SkillRating } from './ratings'

function state(rd = 100) {
  const ratings = new Map<string, SkillRating>([['a', { rating: 1500, rd, volatility: 0 }], ['new', { rating: 1400, rd: 275, volatility: 0 }]])
  const tracker = new RatingInactivityTracker()
  tracker.recordPlayed(['a'], '2026-01-01T14:00:00Z')
  return { ratings, tracker }
}

describe('elapsed inactivity variance', () => {
  it('gives weekly players seven days of grace', () => {
    const { ratings, tracker } = state()
    expect(tracker.apply(ratings, '2026-01-08T23:59:59Z')).toEqual([])
    expect(ratings.get('a')!.rd).toBe(100)
  })

  it('adds variance for partial idle weeks, keeps the mean, and leaves new players alone', () => {
    const { ratings, tracker } = state()
    tracker.apply(ratings, '2026-01-11T00:00:00Z')
    expect(ratings.get('a')!.rd).toBeCloseTo(Math.sqrt(100 ** 2 + 25 ** 2 * 3 / 7), 12)
    expect(ratings.get('a')!.rating).toBe(1500)
    expect(ratings.get('new')!.rd).toBe(275)
    expect(inactivityRatingDeviation(100, 1)).toBeCloseTo(103.07764064044)
    expect(inactivityRatingDeviation(100, 4)).toBeCloseTo(111.80339887499)
  })

  it('charges each idle day once regardless of how many intermediate games or rebuilds occur', () => {
    const stepped = state(), direct = state()
    for (const date of ['2026-01-08', '2026-01-15', '2026-01-15', '2026-01-22', '2026-01-29']) stepped.tracker.apply(stepped.ratings, date)
    direct.tracker.apply(direct.ratings, '2026-01-29')
    expect(stepped.ratings.get('a')!.rd).toBeCloseTo(direct.ratings.get('a')!.rd, 12)
    expect(stepped.tracker.apply(stepped.ratings, '2026-01-29T22:00:00Z')).toEqual([])
  })

  it('starts a new grace period after returning, retaining the updated uncertainty', () => {
    const { ratings, tracker } = state()
    tracker.apply(ratings, '2026-01-29')
    ratings.set('a', { rating: 1520, rd: 80, volatility: 0 }) // A new result learned.
    tracker.recordPlayed(['a'], '2026-01-29')
    expect(tracker.apply(ratings, '2026-02-05')).toEqual([])
    tracker.apply(ratings, '2026-02-12')
    expect(ratings.get('a')!.rd).toBeCloseTo(Math.sqrt(80 ** 2 + 25 ** 2), 12)
    expect(ratings.get('a')!.rating).toBe(1520)
  })

  it('caps long absence and tolerates invalid dates and backwards timestamps', () => {
    const { ratings, tracker } = state(499)
    tracker.apply(ratings, '2026-02-01')
    expect(ratings.get('a')!.rd).toBe(500)
    for (const date of ['not-a-date', '2025-01-01', null, '2026-03-01']) expect(tracker.apply(ratings, date)).toEqual([])
    tracker.recordPlayed(['a'], '2026-01-01')
    expect(tracker.apply(ratings, '2026-03-08')).toEqual([])
    expect(inactivityRatingDeviation(100, NaN)).toBe(100)
    expect(inactivityRatingDeviation(100, -1)).toBe(100)
  })

  it('prefers the preserved result date and falls back only to a valid season date', () => {
    expect(ratingActivityDate({ result_recorded_at: '2026-02-01', season_starts_at: '2026-01-01' })).toBe('2026-02-01')
    expect(ratingActivityDate({ result_recorded_at: 'invalid', season_starts_at: '2026-01-01' })).toBe('2026-01-01')
    expect(ratingActivityDate({ result_recorded_at: null, season_starts_at: '' })).toBeNull()
  })
})

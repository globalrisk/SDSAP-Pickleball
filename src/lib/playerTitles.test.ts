import { describe, expect, it } from 'vitest'
import { assignPlayerTitles, buildTitlePlayerStats, type TitlePlayerStats } from './playerTitles'
import type { RatingHistoryPoint } from '../types'

function point(sequence: number, rating: number, seasonId: string | null): RatingHistoryPoint {
  return {
    id: String(sequence), matchId: seasonId ? `match-${sequence}` : null,
    rating, ratingDeviation: 100, recordedAt: '', sequence, roundNumber: null,
    seasonId, seasonName: seasonId, seasonStartsAt: null, resultRecordedAt: null,
    result: seasonId ? sequence % 2 === 0 ? 'W' : 'L' : null,
    partnerName: null, opponentNames: [], scoreLabel: null,
  }
}

function history(seed = 1800, baseline = 1400, end = 1500) {
  return [
    point(0, seed, null),
    ...Array.from({ length: 6 }, (_, i) => point(i + 1, baseline, 'first')),
    // Skipped tournaments don't enter the player's three-tournament window.
    ...['second', 'fourth', 'eighth'].flatMap((season, i) => [
      point(7 + i * 2, baseline + (end - baseline) * (i * 2 + 1) / 6, season),
      point(8 + i * 2, baseline + (end - baseline) * (i * 2 + 2) / 6, season),
    ]),
  ]
}

function stats(points = history()): TitlePlayerStats {
  return buildTitlePlayerStats({ id: 'a', name: 'A', history: points, matches: [], seasonFinishes: [] })
}

describe('recent tournament trend badges', () => {
  it('recognizes a recovery despite a lifetime drop from the seed', () => {
    const player = stats()
    expect(player.recentRatingDelta).toBe(100)
    expect(player.recentSeasonsPlayed).toBe(3)
    expect(player.recentMatchesPlayed).toBe(6)
    expect(player.matchesBeforeRecentWindow).toBe(6)
    expect(assignPlayerTitles([player]).get('a')).toEqual({
      id: 'climbing', whyParams: { delta: '+100', seasons: 3, matches: 6 },
    })
  })

  it('recognizes a recent decline despite a lifetime gain', () => {
    const player = stats(history(1000, 1500, 1420))
    expect(assignPlayerTitles([player]).get('a')).toEqual({
      id: 'free_fall', whyParams: { delta: '-80', seasons: 3, matches: 6 },
    })
  })

  it('uses sequence order and counts played tournaments, not calendar gaps', () => {
    expect(stats(history().reverse()).recentRatingDelta).toBe(100)
  })

  it('does not turn starting-rating calibration into a falling badge', () => {
    const calibration = [point(0, 1800, null), ...['one', 'two', 'three'].flatMap((season, i) => [
      point(i * 2 + 1, 1700 - i * 100, season), point(i * 2 + 2, 1600 - i * 100, season),
    ])]
    expect(assignPlayerTitles([stats(calibration)]).get('a')?.id).not.toBe('free_fall')
  })

  it('requires five rated matches inside the window and a meaningful 50-point change', () => {
    expect(assignPlayerTitles([stats(history(1800, 1400, 1430))]).get('a')?.id).not.toBe('climbing')
    expect(assignPlayerTitles([stats(history(1800, 1400, 1450))]).get('a')?.id).toBe('climbing')
    const tooFew = history().filter((p) => p.sequence !== 8 && p.sequence !== 10)
    expect(assignPlayerTitles([stats(tooFew)]).get('a')?.id).not.toBe('climbing')
  })

  it('does not infer a trend from history with missing tournament metadata', () => {
    const incomplete = history()
    incomplete[7] = { ...incomplete[7]!, seasonId: null }
    expect(stats(incomplete).recentRatingDelta).toBeNull()
    expect(assignPlayerTitles([stats(incomplete)]).get('a')?.id).not.toBe('climbing')
  })
})

describe('exclusive badge assignment', () => {
  it('awards the rising badge to the strongest eligible player only', () => {
    const first = stats()
    const second = { ...first, id: 'b', name: 'B', recentRatingDelta: 200 }
    const assigned = assignPlayerTitles([first, second])
    expect(assigned.get('a')?.id).not.toBe('climbing')
    expect(assigned.get('b')?.id).toBe('climbing')
    expect(new Set([...assigned.values()].map((title) => title.id)).size).toBe(assigned.size)
  })

  it('awards the falling badge to the largest recent decline only', () => {
    const first = stats(history(1000, 1500, 1420))
    const second = { ...first, id: 'b', name: 'B', recentRatingDelta: -200 }
    const assigned = assignPlayerTitles([first, second])
    expect(assigned.get('a')?.id).not.toBe('free_fall')
    expect(assigned.get('b')).toEqual({
      id: 'free_fall', whyParams: { delta: '-200', seasons: 3, matches: 6 },
    })
  })

  it('resolves tied performances consistently regardless of input order', () => {
    const first = stats()
    const sameName = { ...first, id: 'b' }
    const otherName = { ...first, id: 'c', name: 'C' }
    const ordered = assignPlayerTitles([first, sameName, otherName])
    const reversed = assignPlayerTitles([otherName, sameName, first])
    expect(reversed).toEqual(ordered)
    expect(ordered.get('a')?.id).toBe('climbing')
  })

  it('passes a badge to the next eligible player when the leader has a higher-priority badge', () => {
    const first = { ...stats(), currentStreak: { result: 'W' as const, count: 3 }, recentRatingDelta: 200 }
    const second = { ...stats(), id: 'b', name: 'B' }
    const assigned = assignPlayerTitles([first, second])
    expect(assigned.get('a')?.id).toBe('on_fire')
    expect(assigned.get('b')?.id).toBe('climbing')
    expect(assigned.size).toBe(2)
  })

  it('prioritizes recent form over lifetime achievements and keeps one badge per player', () => {
    const player = { ...stats(), secondPlaceSeasons: 4, underdogWins: 8 }
    expect(assignPlayerTitles([player]).get('a')?.id).toBe('climbing')
    expect(assignPlayerTitles([{ ...player, currentStreak: { result: 'W' as const, count: 3 } }]).get('a')?.id).toBe('on_fire')
  })
})

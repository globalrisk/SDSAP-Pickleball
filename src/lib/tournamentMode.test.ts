import { describe, expect, it } from 'vitest'
import { buildTournamentView, shouldReleaseQueuedMatch } from './tournamentMode'
import type { MatchLiveStatus, MatchStatus } from '../types'

function match(
  id: string,
  round: number,
  status: MatchStatus = 'scheduled',
  liveStatus: MatchLiveStatus = 'available',
  recordedAt: string | null = null,
) {
  return {
    id,
    home_team_id: `${id}-home`,
    away_team_id: `${id}-away`,
    round_number: round,
    status,
    live_status: liveStatus,
    live_court_number: liveStatus === 'playing' ? 1 : null,
    result_recorded_at: recordedAt,
  }
}

describe('buildTournamentView', () => {
  it('releases an outdated single-court queue after a different match starts', () => {
    const queued = match('queued', 1)
    const other = match('other', 2)

    expect(shouldReleaseQueuedMatch(other, queued, 1)).toBe(true)
    expect(shouldReleaseQueuedMatch(queued, queued, 1)).toBe(false)
  })

  it('preserves an independent queue after increasing from one court to two', () => {
    const queued = { ...match('queued', 1), home_team_id: 'A', away_team_id: 'B' }
    const independent = { ...match('independent', 2), home_team_id: 'C', away_team_id: 'D' }
    const overlapping = { ...match('overlapping', 2), home_team_id: 'B', away_team_id: 'C' }

    expect(shouldReleaseQueuedMatch(independent, queued, 1)).toBe(true)
    expect(shouldReleaseQueuedMatch(independent, queued, 2)).toBe(false)
    expect(shouldReleaseQueuedMatch(overlapping, queued, 2)).toBe(true)
  })

  it('releases a stale queue that conflicts with Court 1 before starting Court 2', () => {
    const queued = { ...match('queued', 2), home_team_id: 'A', away_team_id: 'C' }
    const court1 = { ...match('court-1', 1), home_team_id: 'A', away_team_id: 'B' }
    const court2 = { ...match('court-2', 3), home_team_id: 'D', away_team_id: 'E' }

    expect(shouldReleaseQueuedMatch(court2, queued, 2, [court1])).toBe(true)
  })

  it('groups the single-court queue independently of round order', () => {
    const view = buildTournamentView([
      {
        ...match('late-player', 1),
        home_team: { players: [{ is_present: false }, { is_present: true }] },
        away_team: { players: [{ is_present: true }, { is_present: true }] },
      },
      match('playing', 3, 'scheduled', 'playing'),
      match('next', 5, 'scheduled', 'up_next'),
      match('ready', 2),
    ])

    expect(view.playing[0]?.id).toBe('playing')
    expect(view.upNext?.id).toBe('next')
    expect(view.available.map((item) => item.id)).toEqual(['ready'])
    expect(view.waiting.map((item) => item.id)).toEqual(['late-player'])
  })

  it('keeps available fixtures sorted by round only as a reference', () => {
    const view = buildTournamentView([
      match('m3', 3),
      match('m1', 1),
      match('m2', 2),
    ])

    expect(view.available.map((item) => item.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('calculates progress and the most recent result', () => {
    const view = buildTournamentView([
      match('m1', 1, 'completed', 'available', '2026-08-14T01:00:00Z'),
      match('m2', 2, 'forfeit', 'available', '2026-08-14T02:00:00Z'),
      match('m3', 3),
    ])

    expect(view.completedCount).toBe(2)
    expect(view.progressPercent).toBe(67)
    expect(view.recentResult?.id).toBe('m2')
  })

  it('marks a tournament complete when no scheduled fixtures remain', () => {
    const view = buildTournamentView([
      match('m1', 1, 'completed'),
      match('m2', 2, 'forfeit'),
    ])

    expect(view.isComplete).toBe(true)
    expect(view.playing).toEqual([])
    expect(view.available).toEqual([])
    expect(view.progressPercent).toBe(100)
  })

  it('hides ready matches that reuse a team currently playing', () => {
    const playing = {
      ...match('playing', 1, 'scheduled', 'playing'),
      home_team_id: 'A',
      away_team_id: 'B',
    }
    const blocked = {
      ...match('blocked', 2),
      home_team_id: 'A',
      away_team_id: 'C',
    }

    expect(buildTournamentView([playing, blocked]).available).toEqual([])
  })

  it('does not offer a stored up-next match using a team on Court 1', () => {
    const playing = {
      ...match('court-1', 1, 'scheduled', 'playing'),
      home_team_id: 'A',
      away_team_id: 'B',
    }
    const queued = {
      ...match('queued', 2, 'scheduled', 'up_next'),
      home_team_id: 'A',
      away_team_id: 'C',
    }
    const available = {
      ...match('court-2', 3),
      home_team_id: 'C',
      away_team_id: 'D',
    }

    const view = buildTournamentView([playing, queued, available])
    expect(view.upNext).toBeNull()
    expect(view.available.map((item) => item.id)).toEqual(['court-2'])
  })
})

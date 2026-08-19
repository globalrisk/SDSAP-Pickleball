import { describe, expect, it } from 'vitest'
import {
  decideMatchSaveRecovery,
  matchResultSnapshotsEqual,
  type MatchResultSnapshot,
} from './matchSaveRecovery'

const scheduled: MatchResultSnapshot = {
  status: 'scheduled',
  winnerTeamId: null,
  homeScore: null,
  awayScore: null,
}

const completed: MatchResultSnapshot = {
  status: 'completed',
  winnerTeamId: 'home',
  homeScore: 11,
  awayScore: 7,
}

describe('match save recovery', () => {
  it('recognizes an already committed result after a lost response', () => {
    expect(decideMatchSaveRecovery(completed, scheduled, completed)).toBe(
      'already-saved',
    )
  })

  it('allows a retry when the server still has the original state', () => {
    expect(decideMatchSaveRecovery(scheduled, scheduled, completed)).toBe(
      'safe-to-retry',
    )
  })

  it('blocks a retry when another device changed the result', () => {
    const otherResult: MatchResultSnapshot = {
      ...completed,
      winnerTeamId: 'away',
      homeScore: 6,
      awayScore: 11,
    }
    expect(decideMatchSaveRecovery(otherResult, scheduled, completed)).toBe(
      'conflict',
    )
  })

  it('compares nullable scores exactly', () => {
    expect(matchResultSnapshotsEqual(scheduled, { ...scheduled })).toBe(true)
    expect(
      matchResultSnapshotsEqual(scheduled, { ...scheduled, homeScore: 0 }),
    ).toBe(false)
  })
})

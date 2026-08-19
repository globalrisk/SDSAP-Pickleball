import type { MatchStatus } from '../types'

export interface MatchResultSnapshot {
  status: MatchStatus
  winnerTeamId: string | null
  homeScore: number | null
  awayScore: number | null
}

export type MatchSaveRecoveryDecision =
  | 'already-saved'
  | 'safe-to-retry'
  | 'conflict'

export function matchResultSnapshotsEqual(
  left: MatchResultSnapshot,
  right: MatchResultSnapshot,
): boolean {
  return (
    left.status === right.status &&
    left.winnerTeamId === right.winnerTeamId &&
    left.homeScore === right.homeScore &&
    left.awayScore === right.awayScore
  )
}

export function decideMatchSaveRecovery(
  current: MatchResultSnapshot,
  expectedBeforeSave: MatchResultSnapshot,
  desired: MatchResultSnapshot,
): MatchSaveRecoveryDecision {
  if (matchResultSnapshotsEqual(current, desired)) return 'already-saved'
  if (matchResultSnapshotsEqual(current, expectedBeforeSave)) return 'safe-to-retry'
  return 'conflict'
}

export function isLikelyConnectionError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  if (!(error instanceof Error)) return false
  return /fetch|network|offline|timeout|timed out|connection|load failed|failed to send/i.test(
    error.message,
  )
}

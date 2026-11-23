import type { Match } from '../types'

export type DuelMatchLineup = Pick<Match, 'home_pool_player_ids' | 'away_pool_player_ids'>

export function assertReviewedDuelLineup(current: DuelMatchLineup, reviewed?: DuelMatchLineup) {
  if (!reviewed) return
  for (const side of ['home_pool_player_ids', 'away_pool_player_ids'] as const) {
    const before = reviewed[side]
    const after = current[side]
    if (before?.length !== after?.length || before?.some((id, index) => id !== after?.[index])) {
      throw new Error('DUEL_SUB_STALE: Match lineup changed')
    }
  }
}

export function canReplaceDuelMatchPlayer(match: Match): boolean {
  return match.duel_sequence_number != null
    && match.status === 'scheduled'
    && match.live_status !== 'playing'
    && match.betting_closed_at == null
    && match.result_recorded_at == null
    && match.home_pool_player_ids?.length === 2
    && match.away_pool_player_ids?.length === 2
}

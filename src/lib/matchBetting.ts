import { resolveMatchLineups } from './playerMatches'
import type { MatchWithTeams } from '../types'

export function matchBettingStatus(match: MatchWithTeams): 'open' | 'closed' {
  if (match.status !== 'scheduled' || match.live_status === 'playing' || match.betting_closed_at) return 'closed'
  return 'open'
}

/** Actual participants can back their own pair; spectators can back either pair. */
export function matchBettingSides(match: MatchWithTeams, playerId?: string): string[] {
  const { homeIds, awayIds } = resolveMatchLineups(match)
  return [
    ...(!playerId || !awayIds.includes(playerId) ? [match.home_team_id] : []),
    ...(!playerId || !homeIds.includes(playerId) ? [match.away_team_id] : []),
  ]
}

export function canAcceptMatchOffer(match: MatchWithTeams | undefined, creatorSide: string, playerId?: string): boolean {
  if (!match || matchBettingStatus(match) !== 'open' || ![match.home_team_id, match.away_team_id].includes(creatorSide)) return false
  const acceptorSide = creatorSide === match.home_team_id ? match.away_team_id : match.home_team_id
  return matchBettingSides(match, playerId).includes(acceptorSide)
}

/** Wallet amounts are decimal strings; compare funds without floating point rounding. */
export function hasBetFunds(available: string | undefined, stake: string): boolean {
  if (!available || !/^-?\d+(\.\d{1,6})?$/.test(available) || !/^\d+(\.\d{1,6})?$/.test(stake)) return false
  if (available.startsWith('-')) return false
  const micros = (amount: string) => {
    const [whole, fraction = ''] = amount.split('.')
    return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
  }
  return micros(available) >= micros(stake)
}

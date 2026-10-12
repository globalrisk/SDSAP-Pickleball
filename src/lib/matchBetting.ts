import { resolveMatchLineups } from './playerMatches'
import type { MatchWithTeams } from '../types'

export function matchBettingStatus(match: MatchWithTeams, playerId?: string): 'open' | 'closed' | 'participant' {
  if (match.status !== 'scheduled' || match.live_status === 'playing' || match.betting_closed_at) return 'closed'
  const { homeIds, awayIds } = resolveMatchLineups(match)
  return playerId && [...homeIds, ...awayIds].includes(playerId) ? 'participant' : 'open'
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

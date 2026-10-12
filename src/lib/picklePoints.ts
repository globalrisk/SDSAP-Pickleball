/** Format decimal strings without passing earned balances through Number. */
export function formatPicklePoints(value: string): string {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('Invalid Pickle point amount')
  const [whole, fraction = ''] = value.split('.')
  const digits = fraction.padEnd(3, '0')
  let cents = BigInt(whole!) * 100n + BigInt(digits.slice(0, 2))
  if (Number(digits[2]) >= 5) cents += 1n
  const integer = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const decimals = (cents % 100n).toString().padStart(2, '0').replace(/0+$/, '')
  return `${integer}${decimals ? `,${decimals}` : ''} 🥒`
}

export function isPicklePrize(value: string): boolean {
  return /^\d+$/.test(value) && BigInt(value) <= 1_000_000_000_000n && BigInt(value) % 1000n === 0n
}

export interface PicklePrizeAmounts { matchPrize: string; championPrize: string }
export interface PickleSeasonSettings extends PicklePrizeAmounts { configured: boolean }
export interface PickleSettings { defaults: PicklePrizeAmounts; season: PickleSeasonSettings | null }
export interface PickleSquadPreview {
  id: string; name: string; wins: number; matchTotal: string; championTotal: string | null
  total: string; memberCount: number; share: string | null; members: { id: string; name: string }[]
}
export interface PicklePreview extends PicklePrizeAmounts {
  seasonId: string; seasonName: string; leagueId: string; fingerprint: string
  configured: boolean; complete: boolean; valid: boolean; remaining: number; totalMatches: number
  squads: PickleSquadPreview[]; awarded: boolean
}
export interface PickleRankingRow { id: string; name: string; status: string; balance: string; rank: number }
export interface PickleContribution {
  season_id: string; season_name: string; league_name: string; team_name: string; amount: string; awarded_at: string
}

/** Format decimal strings without passing earned balances through Number. */
export function formatPicklePoints(value: string, precision: 2 | 6 = 2): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error('Invalid Pickle point amount')
  const negative = value.startsWith('-')
  if (negative) value = value.slice(1)
  const [whole, fraction = ''] = value.split('.')
  const digits = fraction.padEnd(precision + 1, '0')
  const scale = 10n ** BigInt(precision)
  let units = BigInt(whole!) * scale + BigInt(digits.slice(0, precision))
  if (Number(digits[precision]) >= 5) units += 1n
  const integer = (units / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const decimals = (units % scale).toString().padStart(precision, '0').replace(/0+$/, '')
  return `${negative && units !== 0n ? '-' : ''}${integer}${decimals ? `,${decimals}` : ''} 🥒`
}

export function isPicklePrize(value: string): boolean {
  return /^\d+$/.test(value) && BigInt(value) <= 1_000_000_000_000n && BigInt(value) % 1000n === 0n
}

export function formatSignedPicklePoints(value: string, precision: 2 | 6 = 2): string {
  return `${!value.startsWith('-') && /[1-9]/.test(value) ? '+' : ''}${formatPicklePoints(value, precision)}`
}

export function parsePicklePayoutAmount(input: string): string | null {
  const amount = input.trim().replace(',', '.')
  return /^\d{1,18}(\.\d{1,6})?$/.test(amount) && /[1-9]/.test(amount) ? amount : null
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

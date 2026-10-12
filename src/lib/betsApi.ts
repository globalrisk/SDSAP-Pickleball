import { supabase } from './supabase'
import type { TFunction } from 'i18next'

export function betErrorMessage(error: unknown, t: TFunction): string {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
  const code = message.match(/^(BET_[A-Z_]+):/)?.[1]
  return code ? t(`bets.errors.${code}`, { defaultValue: message }) : message
}

export interface PlayerAccount { playerId: string; name: string }
export interface RegisteredPlayerAccount { email: string; playerId: string | null; playerName: string | null }
export interface PlayerAccountDirectory { accounts: RegisteredPlayerAccount[]; total: number }
export interface PickleWallet { balance: string; reserved: string; available: string; owed: string }
export interface PickleBet {
  id: string; seasonId: string; matchId: string; creatorId: string; creatorName: string
  acceptorId: string | null; acceptorName: string | null; creatorSide: string; homeTeamId: string; awayTeamId: string
  homeNames: string[]; awayNames: string[]; creatorStake: string; acceptorStake: string
  state: 'open' | 'accepted' | 'review' | 'settled' | 'refunded' | 'cancelled' | 'void'
  createdAt: string; closeReason: string | null
}
export interface PickleTransaction {
  id: string; amount: string; kind: 'prize' | 'bet' | 'reversal'; seasonName: string; betId: string | null
  matchId: string | null; revision: number | null; reason: string | null; createdAt: string
}
export interface SettlementPreview {
  matchId: string; fingerprint: string; revision: number; status: string; winnerId: string | null; homeScore: number | null; awayScore: number | null
  bets: { id: string; creatorId: string; creatorName: string; creatorSide: string; acceptorId: string; acceptorName: string
    creatorStake: string; acceptorStake: string; creatorNet: string; acceptorNet: string }[]
}
export interface BetCorrection { reason: string; fingerprint: string; revision: number; requestId: string }
async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data as T
}
export const fetchMyPlayerAccount = () => rpc<PlayerAccount | null>('my_player_account')
export const fetchPlayerAccounts = (leagueId: string) => rpc<{ player_id: string; email: string }[]>('league_player_accounts', { p_league_id: leagueId })
export const fetchPlayerAccountDirectory = (search: string, offset: number, limit = 25) =>
  rpc<PlayerAccountDirectory>('admin_player_account_directory', { p_search: search, p_offset: offset, p_limit: limit })
export const linkPlayerAccount = (playerId: string, email: string) => rpc<void>('link_player_account', { p_player_id: playerId, p_email: email.trim() })
export const unlinkPlayerAccount = (playerId: string, email: string, requestId: string) =>
  rpc<void>('unlink_player_account', { p_player_id: playerId, p_email: email.trim(), p_request_id: requestId })
export const fetchWallet = (leagueId: string) => rpc<PickleWallet>('pickle_wallet', { p_league_id: leagueId })
export const fetchBets = (leagueId: string) => rpc<PickleBet[]>('pickle_bets_list', { p_league_id: leagueId })
export const fetchWalletHistory = (leagueId: string) => rpc<PickleTransaction[]>('pickle_wallet_history', { p_league_id: leagueId })
export const createBet = (matchId: string, sideId: string, creatorStake: string, acceptorStake: string, requestId: string) =>
  rpc<string>('create_pickle_bet', { p_match_id: matchId, p_side_id: sideId, p_creator_stake: creatorStake, p_acceptor_stake: acceptorStake, p_request_id: requestId })
export const acceptBet = (betId: string, requestId: string) => rpc<string>('accept_pickle_bet', { p_bet_id: betId, p_request_id: requestId })
export const cancelBet = (betId: string) => rpc<void>('cancel_pickle_bet', { p_bet_id: betId })
export const fetchSettlementPreview = (matchId: string) => rpc<SettlementPreview>('pickle_settlement_preview', { p_match_id: matchId })
export const confirmSettlement = (preview: SettlementPreview) => rpc<string>('confirm_pickle_settlement', { p_match_id: preview.matchId, p_fingerprint: preview.fingerprint, p_revision: preview.revision })
export function isBetStake(value: string): boolean {
  return /^\d+$/.test(value) && BigInt(value) >= 1000n && BigInt(value) <= 1_000_000_000_000n && BigInt(value) % 1000n === 0n
}
export function addPoints(a: string, b: string): string {
  const micros = (value: string) => {
    if (!/^-?\d+(\.\d{1,6})?$/.test(value)) throw new Error('Invalid Pickle point amount')
    const negative = value.startsWith('-')
    if (negative) value = value.slice(1)
    const [whole, fraction = ''] = value.split('.')
    const amount = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
    return negative ? -amount : amount
  }
  const total = micros(a) + micros(b)
  const absolute = total < 0n ? -total : total
  return `${total < 0n ? '-' : ''}${absolute / 1_000_000n}.${(absolute % 1_000_000n).toString().padStart(6, '0')}`
}

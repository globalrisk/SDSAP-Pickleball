import { supabase } from './supabase'
import { fetchAllPages } from './pagination'
import { isPicklePrize } from './picklePoints'
import type { PickleContribution, PicklePreview, PicklePrizeAmounts, PickleRankingRow, PickleSettings } from './picklePoints'
import type { Season } from '../types'

export async function fetchPickleSettings(leagueId: string, seasonId?: string): Promise<PickleSettings> {
  const { data, error } = await supabase.rpc('pickle_settings', { p_league_id: leagueId, p_season_id: seasonId ?? null })
  if (error) throw error
  return data as PickleSettings
}

export async function savePickleSettings(scope: 'league' | 'season', id: string, amounts: PicklePrizeAmounts): Promise<void> {
  if (!isPicklePrize(amounts.matchPrize) || !isPicklePrize(amounts.championPrize)) throw new Error('Prizes must be multiples of 1,000, up to 1,000,000,000,000.')
  const { error } = await supabase.from(scope === 'league' ? 'pickle_league_settings' : 'pickle_season_settings').upsert({
    [scope === 'league' ? 'league_id' : 'season_id']: id,
    match_prize: amounts.matchPrize, champion_prize: amounts.championPrize,
    ...(scope === 'season' ? { configured: true } : {}),
  }, { onConflict: scope === 'league' ? 'league_id' : 'season_id' })
  if (error) throw error
}

export async function fetchPicklePreview(seasonId: string): Promise<PicklePreview> {
  const { data, error } = await supabase.rpc('pickle_season_preview', { p_season_id: seasonId })
  if (error) throw error
  return data as PicklePreview
}

export interface PickleArchiveResult { season: Season; receipt: PicklePreview | null }
export async function archiveWithPicklePoints(seasonId: string, fingerprint?: string): Promise<PickleArchiveResult> {
  const { data, error } = await supabase.rpc('archive_season_with_pickle_points', {
    p_season_id: seasonId, p_expected_preview: fingerprint ?? null,
  })
  if (error) throw error
  return data as PickleArchiveResult
}

export async function fetchLeaguePickleLeaderboard(leagueId: string): Promise<PickleRankingRow[]> {
  const { data } = await fetchAllPages((from, to) => supabase.rpc('pickle_leaderboard', { p_league_id: leagueId })
    .order('rank').order('name').order('id').range(from, to))
  return data as PickleRankingRow[]
}

export async function fetchPickleContributions(leagueId: string, playerId: string): Promise<PickleContribution[]> {
  const { data } = await fetchAllPages((from, to) => supabase.rpc('pickle_contributions', { p_league_id: leagueId, p_player_id: playerId })
    .order('awarded_at', { ascending: false }).order('season_id').range(from, to))
  return data as PickleContribution[]
}

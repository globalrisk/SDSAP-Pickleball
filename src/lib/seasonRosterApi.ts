import { supabase } from './supabase'

export const seasonRosterQueryKey = (seasonId: string | undefined) =>
  ['season-roster', seasonId] as const

export async function fetchSeasonRosterIds(seasonId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('season_roster')
    .select('pool_player_id')
    .eq('season_id', seasonId)
  if (error) throw error
  return (data ?? []).map((row) => row.pool_player_id)
}

export async function saveSeasonRoster(
  seasonId: string,
  poolPlayerIds: string[],
): Promise<void> {
  const { error } = await supabase.rpc('save_season_roster_atomic', {
    p_season_id: seasonId,
    p_pool_player_ids: poolPlayerIds,
  })
  if (error) throw error
}

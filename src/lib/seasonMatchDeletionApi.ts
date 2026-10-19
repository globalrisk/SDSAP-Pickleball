import { supabase } from './supabase'

export interface SeasonMatchDeletionPreview {
  seasonId: string
  matchCount: number
  betCount: number
  openCount: number
  acceptedCount: number
  releasedPoints: string
  canDelete: boolean
  fingerprint: string
}
export type SeasonMatchDeletionResult = Omit<SeasonMatchDeletionPreview, 'canDelete' | 'fingerprint'>

export async function fetchSeasonMatchDeletionPreview(seasonId: string): Promise<SeasonMatchDeletionPreview> {
  const { data, error } = await supabase.rpc('season_match_deletion_preview', { p_season_id: seasonId })
  if (error) throw error
  return data as SeasonMatchDeletionPreview
}

export async function deleteSeasonMatchesAndBets(preview: SeasonMatchDeletionPreview, requestId: string): Promise<SeasonMatchDeletionResult> {
  const { data, error } = await supabase.rpc('delete_unplayed_season_matches_and_bets', {
    p_season_id: preview.seasonId, p_fingerprint: preview.fingerprint, p_request_id: requestId,
  })
  if (error) throw error
  return data as SeasonMatchDeletionResult
}

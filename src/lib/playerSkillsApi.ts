import { supabase } from './supabase'
import type { MySkillRating, SkillScores, SkillSummary } from './playerSkills'

async function rpc<T>(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const request = supabase.rpc(name, args)
  const { data, error } = await (signal ? request.abortSignal(signal) : request)
  if (error) throw error
  return data as T
}

export const fetchSkillSummary = (playerId: string, signal?: AbortSignal) =>
  rpc<SkillSummary>('player_skill_summary', { p_player_id: playerId }, signal)
export const fetchMySkillRating = (leagueId: string, playerId: string, signal?: AbortSignal) =>
  rpc<MySkillRating>('my_player_skill_rating', { p_league_id: leagueId, p_player_id: playerId }, signal)
export const saveSkillRating = (leagueId: string, playerId: string, scores: SkillScores) =>
  rpc<void>('save_player_skill_rating', { p_league_id: leagueId, p_player_id: playerId, p_scores: scores })
export const removeSkillRating = (playerId: string) =>
  rpc<void>('remove_player_skill_rating', { p_player_id: playerId })

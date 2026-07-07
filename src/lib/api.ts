import { supabase } from './supabase'
import type { MatchWithTeams, Team, TeamWithPlayers } from '../types'

const MATCH_SELECT = `
  *,
  home_team:teams!matches_home_team_id_fkey(id, name, color),
  away_team:teams!matches_away_team_id_fkey(id, name, color),
  winner:teams!matches_winner_team_id_fkey(id, name, color)
`

export async function fetchTeams(): Promise<Team[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .order('id')

  if (error) throw error
  return data ?? []
}

export async function fetchTeamsWithPlayers(): Promise<TeamWithPlayers[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('*, players(*)')
    .order('id')

  if (error) throw error

  return (data ?? []).map((team) => ({
    ...team,
    players: [...(team.players ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
  }))
}

export async function fetchMatches(): Promise<MatchWithTeams[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .order('scheduled_at')

  if (error) throw error
  return (data ?? []) as MatchWithTeams[]
}

export async function recordResult(
  matchId: string,
  payload: {
    winnerTeamId: string
    homeScore?: number
    awayScore?: number
  },
): Promise<void> {
  const { error } = await supabase
    .from('matches')
    .update({
      status: 'completed',
      winner_team_id: payload.winnerTeamId,
      home_score: payload.homeScore ?? null,
      away_score: payload.awayScore ?? null,
    })
    .eq('id', matchId)

  if (error) throw error
}

export async function recordForfeit(
  matchId: string,
  forfeitTeamId: string,
  homeTeamId: string,
  awayTeamId: string,
): Promise<void> {
  const winnerTeamId =
    forfeitTeamId === homeTeamId ? awayTeamId : homeTeamId

  const { error } = await supabase
    .from('matches')
    .update({
      status: 'forfeit',
      winner_team_id: winnerTeamId,
      home_score: null,
      away_score: null,
    })
    .eq('id', matchId)

  if (error) throw error
}

export async function revertMatchToScheduled(matchId: string): Promise<void> {
  const { error } = await supabase
    .from('matches')
    .update({
      status: 'scheduled',
      winner_team_id: null,
      home_score: null,
      away_score: null,
    })
    .eq('id', matchId)

  if (error) throw error
}

export async function updateTeamName(teamId: string, name: string): Promise<void> {
  const { error } = await supabase.from('teams').update({ name }).eq('id', teamId)
  if (error) throw error
}

export async function updatePlayerName(playerId: string, name: string): Promise<void> {
  const { error } = await supabase.from('players').update({ name }).eq('id', playerId)
  if (error) throw error
}

export async function saveTeamWithPlayers(
  teamId: string,
  teamName: string,
  players: { id: string; name: string }[],
): Promise<void> {
  const { error: teamError } = await supabase
    .from('teams')
    .update({ name: teamName })
    .eq('id', teamId)
  if (teamError) throw teamError

  for (const player of players) {
    const { error } = await supabase
      .from('players')
      .update({ name: player.name })
      .eq('id', player.id)
    if (error) throw error
  }
}

export async function resetAllMatches(): Promise<number> {
  const { data, error } = await supabase
    .from('matches')
    .update({
      status: 'scheduled',
      home_score: null,
      away_score: null,
      winner_team_id: null,
    })
    .in('status', ['completed', 'forfeit'])
    .select('id')

  if (error) throw error
  return data?.length ?? 0
}

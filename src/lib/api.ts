import { supabase } from './supabase'
import { GLICKO2_DEFAULTS } from './glicko2'
import {
  applyDoublesMatchToRatings,
  buildRankingRows,
  createInitialRatingsMap,
  type DoublesMatchPlayers,
} from './ratings'
import { buildRoundRobinMatches } from './schedule'
import type { MatchWithTeams, PlayerRankingRow, PoolPlayer, Season, Team, TeamWithPlayers } from '../types'

const MATCH_SELECT = `
  *,
  home_team:teams!matches_home_team_id_fkey(id, name, color, players(name, pool_player_id)),
  away_team:teams!matches_away_team_id_fkey(id, name, color, players(name, pool_player_id)),
  winner:teams!matches_winner_team_id_fkey(id, name, color)
`

export async function fetchSeasons(): Promise<Season[]> {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .order('starts_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function fetchActiveSeason(): Promise<Season | null> {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .eq('status', 'active')
    .maybeSingle()

  if (error) throw error
  return data
}

export async function createSeason(name: string): Promise<Season> {
  const { data, error } = await supabase
    .from('seasons')
    .insert({ name, status: 'active' })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function archiveSeason(seasonId: string): Promise<Season> {
  const { data, error } = await supabase
    .from('seasons')
    .update({ status: 'archived', ends_at: new Date().toISOString() })
    .eq('id', seasonId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function fetchPlayerRankings(): Promise<PlayerRankingRow[]> {
  const { data, error } = await supabase
    .from('player_pool')
    .select('id, name, rating, rating_deviation, volatility')
    .order('rating', { ascending: false })

  if (error) throw error
  return buildRankingRows(data ?? [])
}

interface FinishedMatchForRatings {
  id: string
  scheduled_at: string
  winner_team_id: string
  home_team_id: string
  away_team_id: string
  home_players: { pool_player_id: string }[]
  away_players: { pool_player_id: string }[]
}

async function fetchFinishedMatchesForRatings(): Promise<FinishedMatchForRatings[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      id,
      scheduled_at,
      winner_team_id,
      home_team_id,
      away_team_id,
      home_team:teams!matches_home_team_id_fkey(
        players(pool_player_id)
      ),
      away_team:teams!matches_away_team_id_fkey(
        players(pool_player_id)
      )
    `)
    .in('status', ['completed', 'forfeit'])
    .order('scheduled_at')
    .order('id')

  if (error) throw error

  return (data ?? []).map((row) => {
    const homeTeam = Array.isArray(row.home_team) ? row.home_team[0] : row.home_team
    const awayTeam = Array.isArray(row.away_team) ? row.away_team[0] : row.away_team

    return {
      id: row.id,
      scheduled_at: row.scheduled_at,
      winner_team_id: row.winner_team_id!,
      home_team_id: row.home_team_id,
      away_team_id: row.away_team_id,
      home_players: homeTeam?.players ?? [],
      away_players: awayTeam?.players ?? [],
    }
  })
}

function toDoublesMatchPlayers(match: FinishedMatchForRatings): DoublesMatchPlayers | null {
  if (match.home_players.length !== 2 || match.away_players.length !== 2) return null

  const homeIds = match.home_players.map((p) => p.pool_player_id) as [string, string]
  const awayIds = match.away_players.map((p) => p.pool_player_id) as [string, string]

  if (match.winner_team_id === match.home_team_id) {
    return { winnerPoolIds: homeIds, loserPoolIds: awayIds }
  }
  if (match.winner_team_id === match.away_team_id) {
    return { winnerPoolIds: awayIds, loserPoolIds: homeIds }
  }

  return null
}

export async function recomputeAllRatings(): Promise<void> {
  const { data: pool, error: poolError } = await supabase
    .from('player_pool')
    .select('id, initial_rating')
  if (poolError) throw poolError

  const poolRows = pool ?? []
  const ratings = createInitialRatingsMap(poolRows)
  const finishedMatches = await fetchFinishedMatchesForRatings()

  for (const match of finishedMatches) {
    const doubles = toDoublesMatchPlayers(match)
    if (!doubles) continue
    applyDoublesMatchToRatings(ratings, doubles)
  }

  for (const row of poolRows) {
    const current = ratings.get(row.id) ?? {
      rating: row.initial_rating,
      rd: GLICKO2_DEFAULTS.rd,
      volatility: GLICKO2_DEFAULTS.volatility,
    }
    const { error } = await supabase
      .from('player_pool')
      .update({
        rating: current.rating,
        rating_deviation: current.rd,
        volatility: current.volatility,
      })
      .eq('id', row.id)

    if (error) throw error
  }
}

async function afterMatchResultChange(): Promise<void> {
  await recomputeAllRatings()
}

export async function fetchPlayerPool(): Promise<PoolPlayer[]> {
  const { data, error } = await supabase
    .from('player_pool')
    .select('*')
    .order('name')

  if (error) throw error
  return data ?? []
}

export async function createPoolPlayer(name: string): Promise<PoolPlayer> {
  const { data, error } = await supabase
    .from('player_pool')
    .insert({ name: name.trim() })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updatePoolPlayer(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('player_pool')
    .update({ name: name.trim() })
    .eq('id', id)

  if (error) throw error
}

export async function deletePoolPlayer(id: string): Promise<void> {
  const { count, error: countError } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('pool_player_id', id)

  if (countError) throw countError
  if ((count ?? 0) > 0) {
    throw new Error('Player is assigned to a team and cannot be deleted')
  }

  const { error } = await supabase.from('player_pool').delete().eq('id', id)
  if (error) throw error
}

export async function fetchAssignedPoolPlayerIds(seasonId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('players')
    .select('pool_player_id, teams!inner(season_id)')
    .eq('teams.season_id', seasonId)

  if (error) throw error
  return (data ?? []).map((row) => row.pool_player_id)
}

async function loadPoolPlayersByIds(ids: string[]): Promise<Map<string, PoolPlayer>> {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('player_pool')
    .select('*')
    .in('id', uniqueIds)

  if (error) throw error

  return new Map((data ?? []).map((player) => [player.id, player]))
}

async function assertPoolPlayersAvailable(
  seasonId: string,
  poolPlayerIds: string[],
  excludeTeamId?: string,
): Promise<Map<string, PoolPlayer>> {
  if (poolPlayerIds.length !== 2) {
    throw new Error('A team must have exactly 2 players')
  }

  if (new Set(poolPlayerIds).size !== poolPlayerIds.length) {
    throw new Error('Team players must be different people')
  }

  const poolById = await loadPoolPlayersByIds(poolPlayerIds)
  for (const id of poolPlayerIds) {
    if (!poolById.has(id)) {
      throw new Error('One or more selected players were not found in the pool')
    }
  }

  const { data: assignedRows, error } = await supabase
    .from('players')
    .select('pool_player_id, team_id, teams!inner(season_id)')
    .eq('teams.season_id', seasonId)
    .in('pool_player_id', poolPlayerIds)

  if (error) throw error

  for (const row of assignedRows ?? []) {
    if (excludeTeamId && row.team_id === excludeTeamId) continue
    throw new Error('One or more selected players are already on another team this season')
  }

  return poolById
}

export async function fetchTeams(seasonId: string): Promise<Team[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('season_id', seasonId)
    .order('created_at')

  if (error) throw error
  return data ?? []
}

export async function fetchTeamsWithPlayers(seasonId: string): Promise<TeamWithPlayers[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('*, players(*)')
    .eq('season_id', seasonId)
    .order('created_at')

  if (error) throw error

  return (data ?? []).map((team) => ({
    ...team,
    players: [...(team.players ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }))
}

export async function fetchMatches(seasonId: string): Promise<MatchWithTeams[]> {
  const [matchesResult, ratingsResult] = await Promise.all([
    supabase
      .from('matches')
      .select(MATCH_SELECT)
      .eq('season_id', seasonId)
      .order('scheduled_at'),
    supabase.from('player_pool').select('id, rating'),
  ])

  if (matchesResult.error) throw matchesResult.error
  if (ratingsResult.error) throw ratingsResult.error

  const ratings = new Map(
    (ratingsResult.data ?? []).map((player) => [player.id, player.rating]),
  )
  const matches = (matchesResult.data ?? []) as MatchWithTeams[]

  return matches.map((match) => ({
    ...match,
    home_team: {
      ...match.home_team,
      players: match.home_team.players?.map((player) => ({
        ...player,
        rating: ratings.get(player.pool_player_id),
      })),
    },
    away_team: {
      ...match.away_team,
      players: match.away_team.players?.map((player) => ({
        ...player,
        rating: ratings.get(player.pool_player_id),
      })),
    },
  }))
}

export async function createSeasonMatches(seasonId: string): Promise<number> {
  const { count, error: countError } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', seasonId)

  if (countError) throw countError
  if ((count ?? 0) > 0) {
    throw new Error('This season already has matches')
  }

  const teams = await fetchTeams(seasonId)
  if (teams.length < 2) {
    throw new Error('Need at least 2 teams to create matches')
  }
  if (teams.length % 2 !== 0) {
    throw new Error('Round robin requires an even number of teams')
  }

  const rows = buildRoundRobinMatches(
    seasonId,
    teams.map((team) => team.id),
  )

  const { data, error } = await supabase.from('matches').insert(rows).select('id')
  if (error) throw error
  return data?.length ?? rows.length
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
  await afterMatchResultChange()
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
  await afterMatchResultChange()
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
  await afterMatchResultChange()
}

export async function saveTeamWithPlayers(
  seasonId: string,
  teamId: string,
  teamName: string,
  players: { id: string; poolPlayerId: string }[],
): Promise<void> {
  if (players.length !== 2) {
    throw new Error('A team must have exactly 2 players')
  }

  const poolById = await assertPoolPlayersAvailable(
    seasonId,
    players.map((player) => player.poolPlayerId),
    teamId,
  )

  const { error: teamError } = await supabase
    .from('teams')
    .update({ name: teamName.trim() })
    .eq('id', teamId)
  if (teamError) throw teamError

  for (const player of players) {
    const poolPlayer = poolById.get(player.poolPlayerId)!
    const { error } = await supabase
      .from('players')
      .update({
        pool_player_id: player.poolPlayerId,
        name: poolPlayer.name,
      })
      .eq('id', player.id)
    if (error) throw error
  }
}

export async function createTeamWithPlayers(
  seasonId: string,
  payload: {
    name: string
    color: string
    poolPlayerIds: [string, string]
  },
): Promise<TeamWithPlayers> {
  const poolById = await assertPoolPlayersAvailable(seasonId, payload.poolPlayerIds)

  const { data: team, error: teamError } = await supabase
    .from('teams')
    .insert({
      season_id: seasonId,
      name: payload.name.trim(),
      color: payload.color,
    })
    .select()
    .single()

  if (teamError) throw teamError

  const { data: players, error: playersError } = await supabase
    .from('players')
    .insert(
      payload.poolPlayerIds.map((poolPlayerId) => ({
        name: poolById.get(poolPlayerId)!.name,
        team_id: team.id,
        pool_player_id: poolPlayerId,
      })),
    )
    .select()

  if (playersError) throw playersError

  return {
    ...team,
    players: players ?? [],
  }
}

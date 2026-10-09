import type { SupabaseClient } from '@supabase/supabase-js'
import { replayRatings, type FinishedMatchForRatings } from './ratingReplay.ts'
import { fetchAllPages } from './pagination.ts'

export interface PendingRatingMatch {
  matchId: string
  mode: 'completed' | 'exclude'
  winnerTeamId?: string
  homeScore?: number | null
  awayScore?: number | null
  homePoolPlayerIds?: string[]
  awayPoolPlayerIds?: string[]
  resultRecordedAt?: string | null
}

async function fetchCompletedMatchesForRatings(
  db: SupabaseClient,
  leagueId: string,
  pending?: PendingRatingMatch,
): Promise<FinishedMatchForRatings[]> {
  const { data, error } = await fetchAllPages((from, to) => db
    .from('matches')
    .select(`
      id,
      status,
      season_id,
      round_number,
      result_recorded_at,
      winner_team_id,
      home_team_id,
      away_team_id,
      home_score,
      away_score,
      home_pool_player_ids,
      away_pool_player_ids,
      seasons!inner(starts_at, league_id),
      home_team:teams!matches_home_team_id_fkey(
        players(pool_player_id)
      ),
      away_team:teams!matches_away_team_id_fkey(
        players(pool_player_id)
      )
    `)
    .eq('seasons.league_id', leagueId)
    .order('id')
    .range(from, to),
  )

  if (error) throw error

  const relevantRows = (data ?? []).filter((row) => {
    if (pending && row.id === pending.matchId) return pending.mode === 'completed'
    return row.status === 'completed'
  })

  const rows = relevantRows.map((row) => {
    const homeTeam = Array.isArray(row.home_team) ? row.home_team[0] : row.home_team
    const awayTeam = Array.isArray(row.away_team) ? row.away_team[0] : row.away_team
    const seasonJoin = row.seasons as
      | { starts_at: string }
      | { starts_at: string }[]
      | null
    const season = Array.isArray(seasonJoin) ? seasonJoin[0] : seasonJoin

    const pendingMatch =
      pending && row.id === pending.matchId && pending.mode === 'completed'
        ? pending
        : null
    return {
      id: row.id,
      season_id: row.season_id,
      round_number: row.round_number,
      season_starts_at: season?.starts_at ?? '',
      result_recorded_at: pendingMatch
        ? (pendingMatch.resultRecordedAt ?? row.result_recorded_at)
        : row.result_recorded_at,
      winner_team_id: pendingMatch ? pendingMatch.winnerTeamId! : row.winner_team_id!,
      home_team_id: row.home_team_id,
      away_team_id: row.away_team_id,
      home_score: pendingMatch ? (pendingMatch.homeScore ?? null) : row.home_score,
      away_score: pendingMatch ? (pendingMatch.awayScore ?? null) : row.away_score,
      home_pool_player_ids: pendingMatch
        ? (pendingMatch.homePoolPlayerIds ?? null)
        : row.home_pool_player_ids,
      away_pool_player_ids: pendingMatch
        ? (pendingMatch.awayPoolPlayerIds ?? null)
        : row.away_pool_player_ids,
      home_players: homeTeam?.players ?? [],
      away_players: awayTeam?.players ?? [],
    }
  })

  rows.sort((a, b) => {
    const seasonDiff = a.season_starts_at.localeCompare(b.season_starts_at)
    if (seasonDiff !== 0) return seasonDiff
    const recordedA = a.result_recorded_at ?? ''
    const recordedB = b.result_recorded_at ?? ''
    const recordedDiff = recordedA.localeCompare(recordedB)
    if (recordedDiff !== 0) return recordedDiff
    return a.id.localeCompare(b.id)
  })

  return rows
}

export async function buildRatingsReplacement(
  db: SupabaseClient,
  leagueId: string,
  pending?: PendingRatingMatch,
) {
  // Any commit during the following reads must conflict with this earlier revision.
  const revisionResult = await fetchRatingRevision(db, leagueId)
  const [{ data: pool, error: poolError }, finishedMatches] = await Promise.all([
    fetchAllPages((from, to) => db
      .from('league_players')
      .select('pool_player_id, initial_rating')
      .eq('league_id', leagueId)
      .order('pool_player_id').range(from, to)),
    fetchCompletedMatchesForRatings(db, leagueId, pending),
  ])
  if (poolError) throw poolError
  const now = new Date().toISOString()
  return {
    ...replayRatings({
      pool: (pool ?? []).map((row) => ({ id: row.pool_player_id, initial_rating: row.initial_rating })),
      finishedMatches,
      recordedAt: now,
      asOf: now,
    }),
    expectedRevision: revisionResult,
  }
}

async function fetchRatingRevision(db: SupabaseClient, leagueId: string): Promise<number> {
  const { data, error } = await db
    .from('rating_state')
    .select('revision')
    .eq('league_id', leagueId)
    .single()
  if (!error) return data.revision as number
  throw error
}

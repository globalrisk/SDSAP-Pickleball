import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { replayRatings, type FinishedMatchForRatings } from '../src/lib/ratingReplay.ts'

for (const line of readFileSync(resolve('.env.local'), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue
  const i = line.indexOf('=')
  const key = line.slice(0, i).trim()
  const value = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  if (!(key in process.env)) process.env[key] = value
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!,
)

const [{ data: pool, error: poolError }, { data: matches, error: matchError }] =
  await Promise.all([
    supabase.from('player_pool').select('id, initial_rating'),
    supabase
      .from('matches')
      .select(`
        id, season_id, result_recorded_at, winner_team_id,
        home_team_id, away_team_id, home_score, away_score,
        home_pool_player_ids, away_pool_player_ids,
        seasons(starts_at),
        home_team:teams!matches_home_team_id_fkey(players(pool_player_id)),
        away_team:teams!matches_away_team_id_fkey(players(pool_player_id))
      `)
      .eq('status', 'completed'),
  ])
if (poolError) throw poolError
if (matchError) throw matchError

const finishedMatches = (matches ?? [])
  .map((row): FinishedMatchForRatings => {
    const homeTeam = Array.isArray(row.home_team) ? row.home_team[0] : row.home_team
    const awayTeam = Array.isArray(row.away_team) ? row.away_team[0] : row.away_team
    const season = Array.isArray(row.seasons) ? row.seasons[0] : row.seasons
    return {
      id: row.id,
      season_id: row.season_id,
      season_starts_at: season?.starts_at ?? '',
      result_recorded_at: row.result_recorded_at,
      winner_team_id: row.winner_team_id!,
      home_team_id: row.home_team_id,
      away_team_id: row.away_team_id,
      home_score: row.home_score,
      away_score: row.away_score,
      home_pool_player_ids: row.home_pool_player_ids,
      away_pool_player_ids: row.away_pool_player_ids,
      home_players: homeTeam?.players ?? [],
      away_players: awayTeam?.players ?? [],
    }
  })
  .sort((a, b) => {
    const seasonDiff = a.season_starts_at.localeCompare(b.season_starts_at)
    if (seasonDiff !== 0) return seasonDiff
    const recordedDiff = (a.result_recorded_at ?? '').localeCompare(b.result_recorded_at ?? '')
    return recordedDiff || a.id.localeCompare(b.id)
  })

const seasonRosters = new Map<string, string[]>()
await Promise.all(
  [...new Set(finishedMatches.map((match) => match.season_id))].map(async (seasonId) => {
    const { data, error } = await supabase
      .from('players')
      .select('pool_player_id, teams!inner(season_id)')
      .eq('teams.season_id', seasonId)
    if (error) throw error
    seasonRosters.set(seasonId, [...new Set((data ?? []).map((row) => row.pool_player_id))])
  }),
)

const { data: state, error: stateError } = await supabase
  .from('rating_state')
  .select('revision')
  .eq('id', true)
  .single()
if (stateError) throw stateError

const replacement = replayRatings({
  pool: pool ?? [],
  finishedMatches,
  seasonRosters,
  recordedAt: new Date().toISOString(),
})
const { error: replaceError } = await supabase.rpc('replace_ratings_atomic', {
  p_history_rows: replacement.historyRows,
  p_player_ratings: replacement.playerRatings,
  p_expected_revision: state.revision,
})
if (replaceError) throw replaceError

console.log(
  `Recomputed ratings for ${(pool ?? []).length} players across ${finishedMatches.length} matches`,
)

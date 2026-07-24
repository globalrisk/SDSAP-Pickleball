import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  applyDoublesMatchToRatings,
  applyInactivityToPlayers,
  createInitialRatingsMap,
  TRUESKILL_DEFAULTS,
  type DoublesMatchPlayers,
} from '../src/lib/ratings.ts'

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

function poolIdsFromSnapshotOrRoster(
  snapshot: string[] | null | undefined,
  roster: { pool_player_id: string }[],
): [string, string] | null {
  const ids =
    snapshot && snapshot.length === 2
      ? snapshot
      : roster.map((player) => player.pool_player_id)
  if (ids.length !== 2) return null
  return [ids[0], ids[1]]
}

function toDoubles(match: any): DoublesMatchPlayers | null {
  const homeIds = poolIdsFromSnapshotOrRoster(
    match.home_pool_player_ids,
    match.home_players,
  )
  const awayIds = poolIdsFromSnapshotOrRoster(
    match.away_pool_player_ids,
    match.away_players,
  )
  if (!homeIds || !awayIds || !match.winner_team_id) return null

  if (match.winner_team_id === match.home_team_id) {
    return {
      winnerPoolIds: homeIds,
      loserPoolIds: awayIds,
      winnerScore: match.home_score,
      loserScore: match.away_score,
      matchId: match.id,
    }
  }
  if (match.winner_team_id === match.away_team_id) {
    return {
      winnerPoolIds: awayIds,
      loserPoolIds: homeIds,
      winnerScore: match.away_score,
      loserScore: match.home_score,
      matchId: match.id,
    }
  }
  return null
}

const { data: pool, error: poolError } = await supabase
  .from('player_pool')
  .select('id, initial_rating')
if (poolError) throw poolError

const { data: matches, error: matchError } = await supabase
  .from('matches')
  .select(`
    id, season_id, round_number, result_recorded_at, winner_team_id,
    home_team_id, away_team_id, home_score, away_score,
    home_pool_player_ids, away_pool_player_ids,
    seasons(starts_at),
    home_team:teams!matches_home_team_id_fkey(players(pool_player_id)),
    away_team:teams!matches_away_team_id_fkey(players(pool_player_id))
  `)
  .eq('status', 'completed')
if (matchError) throw matchError

const poolRows = pool ?? []
const ratings = createInitialRatingsMap(poolRows)
const seasonRosterCache = new Map<string, string[]>()

const finished = (matches ?? [])
  .map((row: any) => {
    const homeTeam = Array.isArray(row.home_team) ? row.home_team[0] : row.home_team
    const awayTeam = Array.isArray(row.away_team) ? row.away_team[0] : row.away_team
    const seasonJoin = row.seasons
    const season = Array.isArray(seasonJoin) ? seasonJoin[0] : seasonJoin
    return {
      ...row,
      season_starts_at: season?.starts_at ?? '',
      home_players: homeTeam?.players ?? [],
      away_players: awayTeam?.players ?? [],
    }
  })
  .sort((a: any, b: any) => {
    const seasonDiff = a.season_starts_at.localeCompare(b.season_starts_at)
    if (seasonDiff !== 0) return seasonDiff
    const recordedDiff = (a.result_recorded_at ?? '').localeCompare(
      b.result_recorded_at ?? '',
    )
    if (recordedDiff !== 0) return recordedDiff
    return a.id.localeCompare(b.id)
  })

const historyRows: {
  pool_player_id: string
  match_id: string | null
  rating: number
  rating_deviation: number
  sequence: number
  recorded_at: string
}[] = []

let sequence = 0
const now = new Date().toISOString()

for (const row of poolRows) {
  const initial = ratings.get(row.id)!
  historyRows.push({
    pool_player_id: row.id,
    match_id: null,
    rating: initial.rating,
    rating_deviation: initial.rd,
    sequence: sequence++,
    recorded_at: now,
  })
}

let previousSeasonId: string | null = null

for (const match of finished) {
  if (previousSeasonId && match.season_id !== previousSeasonId) {
    const previousPool = seasonRosterCache.get(previousSeasonId)
    if (previousPool) applyInactivityToPlayers(ratings, previousPool)
  }

  let seasonPoolIds = seasonRosterCache.get(match.season_id)
  if (!seasonPoolIds) {
    const { data, error } = await supabase
      .from('players')
      .select('pool_player_id, teams!inner(season_id)')
      .eq('teams.season_id', match.season_id)
    if (error) throw error
    seasonPoolIds = [...new Set((data ?? []).map((row: any) => row.pool_player_id))]
    seasonRosterCache.set(match.season_id, seasonPoolIds)
  }

  const doubles = toDoubles(match)
  if (doubles) {
    applyDoublesMatchToRatings(ratings, doubles)
    const recordedAt = match.result_recorded_at ?? now
    for (const playerId of [...doubles.winnerPoolIds, ...doubles.loserPoolIds]) {
      const skill = ratings.get(playerId)
      if (!skill) continue
      historyRows.push({
        pool_player_id: playerId,
        match_id: match.id,
        rating: skill.rating,
        rating_deviation: skill.rd,
        sequence: sequence++,
        recorded_at: recordedAt,
      })
    }
  }

  previousSeasonId = match.season_id
}

const { error: clearError } = await supabase.from('rating_history').delete().not('id', 'is', null)
if (clearError) throw clearError

for (let i = 0; i < historyRows.length; i += 200) {
  const chunk = historyRows.slice(i, i + 200)
  const { error } = await supabase.from('rating_history').insert(chunk)
  if (error) throw error
}

const results = await Promise.all(
  poolRows.map((row) => {
    const current = ratings.get(row.id) ?? {
      rating: row.initial_rating,
      rd: TRUESKILL_DEFAULTS.rd,
      volatility: TRUESKILL_DEFAULTS.volatility,
    }
    return supabase
      .from('player_pool')
      .update({
        rating: current.rating,
        rating_deviation: current.rd,
        volatility: current.volatility,
      })
      .eq('id', row.id)
  }),
)

for (const result of results) {
  if (result.error) throw result.error
}

console.log(`Recomputed ratings for ${poolRows.length} players across ${finished.length} matches`)

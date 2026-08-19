import {
  applyDoublesMatchToRatings,
  applySkipSeasonRdBoost,
  createInitialRatingsMap,
  TRUESKILL_DEFAULTS,
  type DoublesMatchPlayers,
} from './ratings'

export interface ReplayPoolPlayer {
  id: string
  initial_rating: number
}

export interface FinishedMatchForRatings {
  id: string
  season_id: string
  season_starts_at: string
  result_recorded_at: string | null
  winner_team_id: string
  home_team_id: string
  away_team_id: string
  home_score: number | null
  away_score: number | null
  home_pool_player_ids: string[] | null
  away_pool_player_ids: string[] | null
  home_players: { pool_player_id: string }[]
  away_players: { pool_player_id: string }[]
}

export interface RatingReplacement {
  historyRows: {
    pool_player_id: string
    match_id: string | null
    rating: number
    rating_deviation: number
    sequence: number
    recorded_at: string
  }[]
  playerRatings: {
    id: string
    rating: number
    rating_deviation: number
    volatility: number
  }[]
}

function resolvePair(
  snapshot: string[] | null | undefined,
  roster: { pool_player_id: string }[],
): [string, string] | null {
  const ids = snapshot?.length === 2 ? snapshot : roster.map((player) => player.pool_player_id)
  return ids.length === 2 ? [ids[0]!, ids[1]!] : null
}

export function toDoublesMatchPlayers(match: FinishedMatchForRatings): DoublesMatchPlayers | null {
  const homeIds = resolvePair(match.home_pool_player_ids, match.home_players)
  const awayIds = resolvePair(match.away_pool_player_ids, match.away_players)
  if (!homeIds || !awayIds) return null
  if (match.winner_team_id === match.home_team_id) {
    return { winnerPoolIds: homeIds, loserPoolIds: awayIds, matchId: match.id }
  }
  if (match.winner_team_id === match.away_team_id) {
    return { winnerPoolIds: awayIds, loserPoolIds: homeIds, matchId: match.id }
  }
  return null
}

/** Canonical deterministic replay used by both the app and maintenance script. */
export function replayRatings({
  pool,
  finishedMatches,
  seasonRosters,
  recordedAt,
}: {
  pool: ReplayPoolPlayer[]
  finishedMatches: FinishedMatchForRatings[]
  seasonRosters: ReadonlyMap<string, string[]>
  recordedAt: string
}): RatingReplacement {
  const ratings = createInitialRatingsMap(pool)
  const historyRows: RatingReplacement['historyRows'] = []
  const hasPlayed = new Set<string>()
  let sequence = 0

  for (const player of pool) {
    const initial = ratings.get(player.id)!
    historyRows.push({
      pool_player_id: player.id,
      match_id: null,
      rating: initial.rating,
      rating_deviation: initial.rd,
      sequence: sequence++,
      recorded_at: recordedAt,
    })
  }

  let previousSeasonId: string | null = null
  for (const match of finishedMatches) {
    if (previousSeasonId && match.season_id !== previousSeasonId) {
      const onRoster = new Set(seasonRosters.get(match.season_id) ?? [])
      const boosted = applySkipSeasonRdBoost(
        ratings,
        [...hasPlayed].filter((id) => !onRoster.has(id)),
      )
      for (const playerId of boosted) {
        const skill = ratings.get(playerId)!
        historyRows.push({
          pool_player_id: playerId,
          match_id: null,
          rating: skill.rating,
          rating_deviation: skill.rd,
          sequence: sequence++,
          recorded_at: match.season_starts_at || recordedAt,
        })
      }
    }

    const doubles = toDoublesMatchPlayers(match)
    if (doubles) {
      applyDoublesMatchToRatings(ratings, doubles)
      for (const playerId of [...doubles.winnerPoolIds, ...doubles.loserPoolIds]) {
        hasPlayed.add(playerId)
        const skill = ratings.get(playerId)!
        historyRows.push({
          pool_player_id: playerId,
          match_id: match.id,
          rating: skill.rating,
          rating_deviation: skill.rd,
          sequence: sequence++,
          recorded_at: match.result_recorded_at ?? recordedAt,
        })
      }
    }
    previousSeasonId = match.season_id
  }

  return {
    historyRows,
    playerRatings: pool.map((player) => {
      const current = ratings.get(player.id) ?? {
        rating: player.initial_rating,
        rd: TRUESKILL_DEFAULTS.rd,
        volatility: TRUESKILL_DEFAULTS.volatility,
      }
      return {
        id: player.id,
        rating: current.rating,
        rating_deviation: current.rd,
        volatility: current.volatility,
      }
    }),
  }
}

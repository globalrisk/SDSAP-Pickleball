import { calculateMatchProbability } from './matchProbability'
import { resolveMatchLineups, scoreLabelForMatch } from './playerMatches'
import { roundRating } from './ratings'
import { computeStandings } from './standings'
import type {
  MatchWithTeams,
  Season,
  SeasonRecap,
  SeasonRecapPlayerAward,
  SeasonRecapTeamAward,
  SeasonRecapUpset,
  TeamWithPlayers,
} from '../types'

export interface RatingHistoryRow {
  pool_player_id: string
  match_id: string | null
  rating: number
  rating_deviation: number
  sequence: number
}

export interface SeasonRecapInput {
  season: Season
  teams: TeamWithPlayers[]
  matches: MatchWithTeams[]
  ratingHistory: RatingHistoryRow[]
  nameById: Map<string, string>
  /** Default RD when no pre-match history exists */
  defaultRd?: number
}

const MIN_IMPROVED_MATCHES = 3
const MIN_PARTNERSHIP_MATCHES = 3
const DEFAULT_RD = 350

function toTeamAward(
  row: ReturnType<typeof computeStandings>[number],
): SeasonRecapTeamAward {
  return {
    teamId: row.team.id,
    teamName: row.team.name,
    color: row.team.color,
    rank: row.rank,
    wins: row.wins,
    losses: row.losses,
    points: row.points,
    playerNames: row.playerNames,
    players: row.players,
  }
}

function percentileRanks(values: number[]): Map<number, number> {
  const sorted = [...values].sort((a, b) => a - b)
  const map = new Map<number, number>()
  if (sorted.length === 0) return map
  if (sorted.length === 1) {
    map.set(sorted[0]!, 1)
    return map
  }
  for (let i = 0; i < sorted.length; i++) {
    const value = sorted[i]!
    // Keep max percentile if duplicates
    map.set(value, i / (sorted.length - 1))
  }
  return map
}

/**
 * Build pre-match ratings: for each (player, match), use the most recent
 * rating_history row with sequence strictly less than the first post-match row
 * for that match, else the latest row before any of the player's season matches.
 */
function buildPreMatchRatings(
  matches: MatchWithTeams[],
  ratingHistory: RatingHistoryRow[],
  defaultRd: number,
): Map<string, { rating: number; rd: number }> {
  const byPlayer = new Map<string, RatingHistoryRow[]>()
  for (const row of ratingHistory) {
    const list = byPlayer.get(row.pool_player_id) ?? []
    list.push(row)
    byPlayer.set(row.pool_player_id, list)
  }
  for (const list of byPlayer.values()) {
    list.sort((a, b) => a.sequence - b.sequence)
  }

  const postMatchMinSequence = new Map<string, Map<string, number>>()
  for (const row of ratingHistory) {
    if (!row.match_id) continue
    let perMatch = postMatchMinSequence.get(row.pool_player_id)
    if (!perMatch) {
      perMatch = new Map()
      postMatchMinSequence.set(row.pool_player_id, perMatch)
    }
    const existing = perMatch.get(row.match_id)
    if (existing == null || row.sequence < existing) {
      perMatch.set(row.match_id, row.sequence)
    }
  }

  const result = new Map<string, { rating: number; rd: number }>()

  for (const match of matches) {
    if (match.status !== 'completed') continue
    const { homeIds, awayIds } = resolveMatchLineups(match)
    for (const playerId of [...homeIds, ...awayIds]) {
      const key = `${match.id}:${playerId}`
      const history = byPlayer.get(playerId) ?? []
      const postSeq = postMatchMinSequence.get(playerId)?.get(match.id)

      let chosen: RatingHistoryRow | null = null
      if (postSeq != null) {
        for (const row of history) {
          if (row.sequence >= postSeq) break
          chosen = row
        }
      } else {
        // No post-match history for this match: use latest overall history before end
        chosen = history.length > 0 ? history[history.length - 1]! : null
        // Prefer starting (match_id null) if that's all we have at sequence 0
        const start = history.find((row) => row.match_id == null)
        if (start && history.every((row) => row.sequence >= (postSeq ?? Infinity))) {
          chosen = start
        }
      }

      // If still nothing useful, walk history for any row not tied to this match
      if (!chosen) {
        for (const row of history) {
          if (row.match_id === match.id) break
          chosen = row
        }
      }

      result.set(key, {
        rating: chosen?.rating ?? 1500,
        rd: chosen?.rating_deviation ?? defaultRd,
      })
    }
  }

  return result
}

function seasonRatingDelta(
  playerId: string,
  seasonMatches: MatchWithTeams[],
  ratingHistory: RatingHistoryRow[],
): { delta: number; played: number; start: number; end: number } | null {
  const completed = seasonMatches
    .filter((match) => match.status === 'completed')
    .sort((a, b) => {
      const dateDiff = (a.result_recorded_at ?? '').localeCompare(b.result_recorded_at ?? '')
      if (dateDiff !== 0) return dateDiff
      return a.id.localeCompare(b.id)
    })

  const playerMatchIds: string[] = []
  for (const match of completed) {
    const { homeIds, awayIds } = resolveMatchLineups(match)
    if (homeIds.includes(playerId) || awayIds.includes(playerId)) {
      playerMatchIds.push(match.id)
    }
  }
  if (playerMatchIds.length === 0) return null

  const history = ratingHistory
    .filter((row) => row.pool_player_id === playerId)
    .sort((a, b) => a.sequence - b.sequence)

  const firstMatchId = playerMatchIds[0]!
  const lastMatchId = playerMatchIds[playerMatchIds.length - 1]!

  const firstPost = history.find((row) => row.match_id === firstMatchId)
  const lastPost = [...history].reverse().find((row) => row.match_id === lastMatchId)

  let startRating = 1500
  if (firstPost) {
    const before = [...history].reverse().find((row) => row.sequence < firstPost.sequence)
    startRating = before?.rating ?? history.find((row) => row.match_id == null)?.rating ?? 1500
  } else {
    startRating = history.find((row) => row.match_id == null)?.rating ?? 1500
  }

  const endRating = lastPost?.rating ?? startRating

  return {
    delta: endRating - startRating,
    played: playerMatchIds.length,
    start: startRating,
    end: endRating,
  }
}

function playerSeasonWins(
  playerId: string,
  matches: MatchWithTeams[],
): { wins: number; played: number } {
  let wins = 0
  let played = 0
  for (const match of matches) {
    if (match.status !== 'completed' || !match.winner_team_id) continue
    const { homeIds, awayIds } = resolveMatchLineups(match)
    const onHome = homeIds.includes(playerId)
    const onAway = awayIds.includes(playerId)
    if (!onHome && !onAway) continue
    played += 1
    const won =
      (onHome && match.winner_team_id === match.home_team_id) ||
      (!onHome && match.winner_team_id === match.away_team_id)
    if (won) wins += 1
  }
  return { wins, played }
}

export function computeSeasonRecap(input: SeasonRecapInput): SeasonRecap {
  const { season, teams, matches, ratingHistory, nameById } = input
  const defaultRd = input.defaultRd ?? DEFAULT_RD

  const finishedForStandings = matches.filter(
    (match) => match.status === 'completed' || match.status === 'forfeit',
  )
  const completed = matches.filter((match) => match.status === 'completed')
  const scheduledLeft = matches.filter((match) => match.status === 'scheduled').length
  const isPartial = season.status === 'archived' && scheduledLeft > 0

  const standings = computeStandings(teams, finishedForStandings)
  const champions = standings.filter((row) => row.rank === 1).map(toTeamAward)
  const runnersUp = standings.filter((row) => row.rank === 2).map(toTeamAward)
  const championPlayerIds = new Set(
    champions.flatMap((team) => team.players.map((player) => player.poolPlayerId)),
  )

  // Biggest upset (historical pre-match ratings)
  const preMatch = buildPreMatchRatings(completed, ratingHistory, defaultRd)
  let biggestUpset: SeasonRecapUpset | null = null

  for (const match of completed) {
    if (!match.winner_team_id) continue
    const { homeIds, awayIds } = resolveMatchLineups(match)
    if (homeIds.length === 0 || awayIds.length === 0) continue

    const homePlayers = homeIds.map((id) => {
      const skill = preMatch.get(`${match.id}:${id}`)
      return {
        rating: skill?.rating ?? 1500,
        ratingDeviation: skill?.rd ?? defaultRd,
      }
    })
    const awayPlayers = awayIds.map((id) => {
      const skill = preMatch.get(`${match.id}:${id}`)
      return {
        rating: skill?.rating ?? 1500,
        ratingDeviation: skill?.rd ?? defaultRd,
      }
    })

    const probability = calculateMatchProbability(
      { players: homePlayers },
      { players: awayPlayers },
    )
    if (!probability) continue

    const homeWon = match.winner_team_id === match.home_team_id
    const winnerPercent = Math.round((homeWon ? probability.home : probability.away) * 100)
    const winnerTeamName = homeWon ? match.home_team.name : match.away_team.name
    const loserTeamName = homeWon ? match.away_team.name : match.home_team.name

    if (!biggestUpset || winnerPercent < biggestUpset.winnerPercent) {
      biggestUpset = {
        matchId: match.id,
        winnerTeamName,
        loserTeamName,
        scoreLabel: scoreLabelForMatch(match),
        winnerPercent,
        resultRecordedAt: match.result_recorded_at,
      }
    }
  }

  // Most improved
  const rosterIds = new Set(
    teams.flatMap((team) => team.players.map((player) => player.pool_player_id)),
  )
  let mostImproved: SeasonRecapPlayerAward | null = null
  let bestDelta = -Infinity

  for (const playerId of rosterIds) {
    const deltaInfo = seasonRatingDelta(playerId, matches, ratingHistory)
    if (!deltaInfo || deltaInfo.played < MIN_IMPROVED_MATCHES) continue
    const winsInfo = playerSeasonWins(playerId, matches)
    if (
      deltaInfo.delta > bestDelta ||
      (deltaInfo.delta === bestDelta &&
        mostImproved &&
        winsInfo.wins > Number(mostImproved.detailParams.wins ?? 0))
    ) {
      bestDelta = deltaInfo.delta
      mostImproved = {
        playerId,
        playerName: nameById.get(playerId) ?? '?',
        detailParams: {
          delta: roundRating(deltaInfo.delta) > 0
            ? `+${roundRating(deltaInfo.delta)}`
            : String(roundRating(deltaInfo.delta)),
          played: deltaInfo.played,
          wins: winsInfo.wins,
        },
      }
    }
  }

  // Best partnership (team win rate)
  let bestPartnership: SeasonRecapTeamAward | null = null
  for (const row of standings) {
    if (row.played < MIN_PARTNERSHIP_MATCHES) continue
    const winRate = row.wins / row.played
    const currentRate = bestPartnership
      ? bestPartnership.wins / Math.max(bestPartnership.wins + bestPartnership.losses, 1)
      : -1
    if (
      !bestPartnership ||
      winRate > currentRate ||
      (winRate === currentRate && row.wins > bestPartnership.wins) ||
      (winRate === currentRate &&
        row.wins === bestPartnership.wins &&
        row.rank < bestPartnership.rank)
    ) {
      bestPartnership = toTeamAward(row)
    }
  }

  // MVP: 50% win-rate percentile, 30% rating-gain percentile, 20% champion bonus
  const candidates: {
    playerId: string
    wins: number
    played: number
    winRate: number
    delta: number
    onChampion: boolean
  }[] = []

  for (const playerId of rosterIds) {
    const winsInfo = playerSeasonWins(playerId, matches)
    if (winsInfo.played < 1) continue
    const deltaInfo = seasonRatingDelta(playerId, matches, ratingHistory)
    candidates.push({
      playerId,
      wins: winsInfo.wins,
      played: winsInfo.played,
      winRate: winsInfo.wins / winsInfo.played,
      delta: deltaInfo?.delta ?? 0,
      onChampion: championPlayerIds.has(playerId),
    })
  }

  const winRatePct = percentileRanks(candidates.map((row) => row.winRate))
  const deltaPct = percentileRanks(candidates.map((row) => row.delta))

  let mvp: SeasonRecapPlayerAward | null = null
  let bestScore = -Infinity

  for (const row of candidates) {
    const score =
      0.5 * (winRatePct.get(row.winRate) ?? 0) +
      0.3 * (deltaPct.get(row.delta) ?? 0) +
      0.2 * (row.onChampion ? 1 : 0)

    if (score > bestScore || (score === bestScore && row.wins > Number(mvp?.detailParams.wins ?? 0))) {
      bestScore = score
      mvp = {
        playerId: row.playerId,
        playerName: nameById.get(row.playerId) ?? '?',
        detailParams: {
          wins: row.wins,
          played: row.played,
          winRate: Math.round(row.winRate * 100),
          delta:
            roundRating(row.delta) > 0
              ? `+${roundRating(row.delta)}`
              : String(roundRating(row.delta)),
          championBonus: row.onChampion ? 1 : 0,
        },
      }
    }
  }

  return {
    seasonId: season.id,
    seasonName: season.name,
    isPartial,
    champions,
    runnersUp,
    biggestUpset,
    mostImproved,
    bestPartnership,
    mvp,
  }
}

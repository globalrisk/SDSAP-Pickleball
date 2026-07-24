import { calculateMatchProbability } from './matchProbability'
import { roundRating } from './ratings'
import type { MatchWithTeams, RatingHistoryPoint } from '../types'

export interface StreakStat {
  result: 'W' | 'L'
  count: number
}

export interface PartnerStat {
  name: string
  wins: number
  played: number
}

export interface OpponentStat {
  name: string
  lossesAgainst: number
  played: number
}

export interface SwingStat {
  delta: number
  result: 'W' | 'L' | null
  partnerName: string | null
  opponentNames: string[]
  scoreLabel: string | null
  seasonName: string | null
  resultRecordedAt: string | null
}

export interface PlayerFunStats {
  currentStreak: StreakStat | null
  bestPartner: PartnerStat | null
  toughestOpponent: OpponentStat | null
  biggestSwing: SwingStat | null
}

export interface HotStreakHighlight {
  playerId: string
  playerName: string
  count: number
}

export interface ClosestMatchHighlight {
  match: MatchWithTeams
  homePercent: number
}

export interface UpsetHighlight {
  match: MatchWithTeams
  winnerName: string
  loserName: string
  winnerPercent: number
  scoreLabel: string | null
}

export interface LeagueHighlights {
  hotStreak: HotStreakHighlight | null
  closestMatch: ClosestMatchHighlight | null
  recentUpset: UpsetHighlight | null
}

/** Chronological match points only (oldest → newest). */
export function chronologicalMatchPoints(
  history: RatingHistoryPoint[],
): RatingHistoryPoint[] {
  return history
    .filter((point) => point.matchId && point.result)
    .slice()
    .sort((a, b) => {
      const recordedDiff = (a.resultRecordedAt ?? '').localeCompare(
        b.resultRecordedAt ?? '',
      )
      if (recordedDiff !== 0) return recordedDiff
      return a.sequence - b.sequence
    })
}

export function computeCurrentStreak(
  results: ('W' | 'L')[],
): StreakStat | null {
  if (results.length === 0) return null
  const last = results[results.length - 1]!
  let count = 0
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i] !== last) break
    count += 1
  }
  return { result: last, count }
}

export function computePlayerFunStats(
  history: RatingHistoryPoint[],
): PlayerFunStats {
  const matches = chronologicalMatchPoints(history)
  const results = matches.map((point) => point.result!) as ('W' | 'L')[]

  const partnerMap = new Map<string, { wins: number; played: number }>()
  const opponentMap = new Map<string, { lossesAgainst: number; played: number }>()

  for (const point of matches) {
    if (point.partnerName) {
      const row = partnerMap.get(point.partnerName) ?? { wins: 0, played: 0 }
      row.played += 1
      if (point.result === 'W') row.wins += 1
      partnerMap.set(point.partnerName, row)
    }
    for (const name of point.opponentNames) {
      const row = opponentMap.get(name) ?? { lossesAgainst: 0, played: 0 }
      row.played += 1
      if (point.result === 'L') row.lossesAgainst += 1
      opponentMap.set(name, row)
    }
  }

  let bestPartner: PartnerStat | null = null
  for (const [name, row] of partnerMap) {
    if (row.played < 2) continue
    const candidate = { name, wins: row.wins, played: row.played }
    if (
      !bestPartner ||
      candidate.wins / candidate.played > bestPartner.wins / bestPartner.played ||
      (candidate.wins / candidate.played === bestPartner.wins / bestPartner.played &&
        candidate.played > bestPartner.played)
    ) {
      bestPartner = candidate
    }
  }
  // Fallback: most wins together if no one has 2+ games
  if (!bestPartner) {
    for (const [name, row] of partnerMap) {
      const candidate = { name, wins: row.wins, played: row.played }
      if (!bestPartner || candidate.wins > bestPartner.wins) {
        bestPartner = candidate
      }
    }
  }

  let toughestOpponent: OpponentStat | null = null
  for (const [name, row] of opponentMap) {
    if (row.played < 2 && row.lossesAgainst === 0) continue
    const candidate = {
      name,
      lossesAgainst: row.lossesAgainst,
      played: row.played,
    }
    if (
      !toughestOpponent ||
      candidate.lossesAgainst > toughestOpponent.lossesAgainst ||
      (candidate.lossesAgainst === toughestOpponent.lossesAgainst &&
        candidate.played > toughestOpponent.played)
    ) {
      toughestOpponent = candidate
    }
  }

  let biggestSwing: SwingStat | null = null
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]!
    const curr = history[i]!
    if (!curr.matchId) continue
    const delta = curr.rating - prev.rating
    if (!biggestSwing || Math.abs(delta) > Math.abs(biggestSwing.delta)) {
      biggestSwing = {
        delta,
        result: curr.result,
        partnerName: curr.partnerName,
        opponentNames: curr.opponentNames,
        scoreLabel: curr.scoreLabel,
        seasonName: curr.seasonName,
        resultRecordedAt: curr.resultRecordedAt,
      }
    }
  }

  return {
    currentStreak: computeCurrentStreak(results),
    bestPartner,
    toughestOpponent,
    biggestSwing,
  }
}

function playerNameById(match: MatchWithTeams): Map<string, string> {
  const map = new Map<string, string>()
  for (const player of match.home_team.players ?? []) {
    map.set(player.pool_player_id, player.name)
  }
  for (const player of match.away_team.players ?? []) {
    map.set(player.pool_player_id, player.name)
  }
  return map
}

function completedChronological(matches: MatchWithTeams[]): MatchWithTeams[] {
  return matches
    .filter((match) => match.status === 'completed')
    .slice()
    .sort((a, b) => {
      const diff = (a.result_recorded_at ?? '').localeCompare(
        b.result_recorded_at ?? '',
      )
      if (diff !== 0) return diff
      return a.id.localeCompare(b.id)
    })
}

export function computeLeagueHighlights(
  matches: MatchWithTeams[],
): LeagueHighlights {
  const completed = completedChronological(matches)

  // Current win streaks from season results
  const resultsByPlayer = new Map<string, { name: string; results: ('W' | 'L')[] }>()
  for (const match of completed) {
    if (!match.winner_team_id) continue
    const names = playerNameById(match)
    const homeIds =
      match.home_pool_player_ids ??
      (match.home_team.players ?? []).map((player) => player.pool_player_id)
    const awayIds =
      match.away_pool_player_ids ??
      (match.away_team.players ?? []).map((player) => player.pool_player_id)
    const homeWon = match.winner_team_id === match.home_team_id

    for (const id of homeIds) {
      const row = resultsByPlayer.get(id) ?? {
        name: names.get(id) ?? '?',
        results: [],
      }
      row.results.push(homeWon ? 'W' : 'L')
      resultsByPlayer.set(id, row)
    }
    for (const id of awayIds) {
      const row = resultsByPlayer.get(id) ?? {
        name: names.get(id) ?? '?',
        results: [],
      }
      row.results.push(homeWon ? 'L' : 'W')
      resultsByPlayer.set(id, row)
    }
  }

  let hotStreak: HotStreakHighlight | null = null
  for (const [playerId, row] of resultsByPlayer) {
    const streak = computeCurrentStreak(row.results)
    if (!streak || streak.result !== 'W' || streak.count < 2) continue
    if (!hotStreak || streak.count > hotStreak.count) {
      hotStreak = { playerId, playerName: row.name, count: streak.count }
    }
  }

  let closestMatch: ClosestMatchHighlight | null = null
  for (const match of matches) {
    if (match.status !== 'scheduled') continue
    const probability = calculateMatchProbability(match.home_team, match.away_team)
    if (!probability) continue
    const homePercent = Math.round(probability.home * 100)
    const closeness = Math.abs(50 - homePercent)
    if (
      !closestMatch ||
      closeness < Math.abs(50 - closestMatch.homePercent)
    ) {
      closestMatch = { match, homePercent }
    }
  }

  let recentUpset: UpsetHighlight | null = null
  const recentCompleted = completed.slice(-8).reverse()
  for (const match of recentCompleted) {
    if (!match.winner_team_id) continue
    const probability = calculateMatchProbability(match.home_team, match.away_team)
    if (!probability) continue
    const homeWon = match.winner_team_id === match.home_team_id
    const winnerPercent = Math.round((homeWon ? probability.home : probability.away) * 100)
    if (winnerPercent >= 45) continue
    const winnerName = homeWon ? match.home_team.name : match.away_team.name
    const loserName = homeWon ? match.away_team.name : match.home_team.name
    const scoreLabel =
      match.home_score != null && match.away_score != null
        ? `${match.home_score}-${match.away_score}`
        : null
    if (!recentUpset || winnerPercent < recentUpset.winnerPercent) {
      recentUpset = { match, winnerName, loserName, winnerPercent, scoreLabel }
    }
  }

  return { hotStreak, closestMatch, recentUpset }
}

export function formatSwingDelta(delta: number): string {
  const rounded = roundRating(delta)
  if (rounded > 0) return `+${rounded}`
  return String(rounded)
}

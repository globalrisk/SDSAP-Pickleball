import { calculateMatchProbability } from './matchProbability'
import type { MatchWithTeams } from '../types'

export interface SeasonForecast {
  homeWinProbability: number
  awayWinProbability: number
  tieProbability: number
  expectedHomeWins: number
  expectedAwayWins: number
  totalGames: number
  remainingGames: number
}

/** Exact outcome distribution conditional on independent game probabilities. */
export function forecastSeason(probabilities: readonly number[], homeWins = 0, awayWins = 0): SeasonForecast {
  if (![homeWins, awayWins].every(value => Number.isInteger(value) && value >= 0)
    || probabilities.some(p => !Number.isFinite(p) || p < 0 || p > 1)) throw new Error('Invalid season forecast inputs')
  const distribution = Array<number>(probabilities.length + 1).fill(0)
  distribution[0] = 1
  let expectedHomeWins = homeWins
  probabilities.forEach((p, i) => {
    for (let wins = i + 1; wins >= 0; wins--) {
      distribution[wins] = (distribution[wins] ?? 0) * (1 - p) + (wins > 0 ? distribution[wins - 1]! * p : 0)
    }
    expectedHomeWins += p
  })
  let homeWinProbability = 0, awayWinProbability = 0, tieProbability = 0
  distribution.forEach((p, wins) => {
    const margin = homeWins + wins - (awayWins + probabilities.length - wins)
    if (margin > 0) homeWinProbability += p
    else if (margin < 0) awayWinProbability += p
    else tieProbability += p
  })
  const totalGames = homeWins + awayWins + probabilities.length
  return { homeWinProbability, awayWinProbability, tieProbability, expectedHomeWins,
    expectedAwayWins: totalGames - expectedHomeWins, totalGames, remainingGames: probabilities.length }
}

export const MAX_DRAFT_SEASON_WIN_CHANCE = 0.55

/** A versus B, conditional on the season having an outright winner. */
export function decisiveSeasonChances(forecast: SeasonForecast): { home: number; away: number } | null {
  const home = forecast.homeWinProbability, away = forecast.awayWinProbability
  const decisive = home + away
  if (![home, away].every(p => Number.isFinite(p) && p >= 0) || decisive <= 0) return null
  return { home: home / decisive, away: away / decisive }
}

export function isSeasonForecastBalanced(forecast: SeasonForecast): boolean {
  const chances = decisiveSeasonChances(forecast)
  return !!chances && Math.max(chances.home, chances.away) <= MAX_DRAFT_SEASON_WIN_CHANCE + 1e-12
}

/** Compare squads' outright chances without letting tie mass hide a bias. */
export function seasonForecastImbalance(forecast: SeasonForecast): number {
  const chances = decisiveSeasonChances(forecast)
  return chances ? Math.round(Math.abs(chances.home - chances.away) * 1e12) / 1e12 : 0
}

/** Uses each frozen doubles lineup, current league ratings, and all recorded results. */
export function forecastLeagueDuelSeason(matches: readonly MatchWithTeams[], teamIds: readonly [string, string]): SeasonForecast | null {
  if (!matches.length || teamIds[0] === teamIds[1]) return null
  const probabilities: number[] = []
  let homeWins = 0, awayWins = 0
  for (const match of matches) {
    if (!teamIds.includes(match.home_team_id) || !teamIds.includes(match.away_team_id)
      || match.home_team_id === match.away_team_id) return null
    if (match.status !== 'scheduled') {
      if (match.winner_team_id === teamIds[0]) homeWins++
      else if (match.winner_team_id === teamIds[1]) awayWins++
      else return null
      continue
    }
    const sides = [match.home_team.players, match.away_team.players]
    if (sides.some(players => players?.length !== 2 || players.some(player => !Number.isFinite(player.rating)))) return null
    const probability = calculateMatchProbability(match.home_team, match.away_team)
    if (!probability) return null
    probabilities.push(match.home_team_id === teamIds[0] ? probability.home : probability.away)
  }
  return forecastSeason(probabilities, homeWins, awayWins)
}

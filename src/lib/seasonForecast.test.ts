import { describe, expect, it } from 'vitest'
import { decisiveSeasonChances, forecastLeagueDuelSeason, forecastSeason, isSeasonForecastBalanced, seasonForecastImbalance } from './seasonForecast'
import type { MatchWithTeams } from '../types'

function enumerate(probabilities: number[], homeWins = 0, awayWins = 0) {
  let home = 0, away = 0, tie = 0, expected = homeWins
  probabilities.forEach(p => { expected += p })
  for (let bits = 0; bits < 2 ** probabilities.length; bits++) {
    let p = 1, wins = homeWins
    probabilities.forEach((chance, index) => { const won = !!(bits & (1 << index)); p *= won ? chance : 1 - chance; if (won) wins++ })
    const losses = homeWins + awayWins + probabilities.length - wins
    if (wins > losses) home += p
    else if (wins < losses) away += p
    else tie += p
  }
  return { home, away, tie, expected }
}

function game(id: string, reversed = false): MatchWithTeams {
  const team = (id: string) => ({ id, name: id, color: '#000', players: [0, 1].map(i => ({ pool_player_id: `${id}${i}`, name: `${id}${i}`, is_present: true, rating: 1500, ratingDeviation: 100 })) })
  const home = reversed ? 'b' : 'a', away = reversed ? 'a' : 'b'
  return { id, season_id: 'season', home_team_id: home, away_team_id: away, home_team: team(home), away_team: team(away),
    status: 'scheduled', winner_team_id: null, winner: null, live_status: 'available', live_court_number: null,
    home_score: null, away_score: null, round_number: 1, home_pool_player_ids: [home + '0', home + '1'],
    away_pool_player_ids: [away + '0', away + '1'], result_recorded_at: null, created_at: '' }
}

describe('season outcome forecasts', () => {
  it('matches every possible result combination for unequal game chances and fixed results', () => {
    for (let size = 0; size <= 8; size++) for (const fixed of [[0, 0], [3, 1], [1, 4]]) {
      const p = Array.from({ length: size }, (_, i) => (i + 1) / (size + 2))
      const reference = enumerate(p, fixed[0], fixed[1])
      const actual = forecastSeason(p, fixed[0], fixed[1])
      expect(actual.homeWinProbability).toBeCloseTo(reference.home, 12)
      expect(actual.awayWinProbability).toBeCloseTo(reference.away, 12)
      expect(actual.tieProbability).toBeCloseTo(reference.tie, 12)
      expect(actual.expectedHomeWins).toBeCloseTo(reference.expected, 12)
      expect(actual.homeWinProbability + actual.awayWinProbability + actual.tieProbability).toBeCloseTo(1, 12)
      expect(actual.expectedHomeWins + actual.expectedAwayWins).toBeCloseTo(size + fixed[0]! + fixed[1]!, 12)
    }
  })
  it('uses all 21 games instead of the closest game or average probability', () => {
    const probabilities = [...Array<number>(20).fill(0.7), 0.5]
    const forecast = forecastSeason(probabilities)
    expect(forecast.homeWinProbability).toBeGreaterThan(0.9)
    expect(forecast.expectedHomeWins).toBeCloseTo(14.5)
    expect(forecast.tieProbability).toBe(0)
    expect(forecastSeason(Array<number>(21).fill(0.5)).homeWinProbability).toBeCloseTo(0.5)
  })
  it('keeps joint champions separate and recognizes clinches and finished seasons', () => {
    expect(forecastSeason([0.5, 0.5])).toMatchObject({ homeWinProbability: 0.25, awayWinProbability: 0.25, tieProbability: 0.5 })
    expect(seasonForecastImbalance(forecastSeason([0.5, 0.5]))).toBe(0)
    expect(forecastSeason([0.1], 4, 1).homeWinProbability).toBe(1)
    expect(forecastSeason([], 3, 3)).toMatchObject({ homeWinProbability: 0, awayWinProbability: 0, tieProbability: 1, expectedHomeWins: 3, expectedAwayWins: 3 })
    expect(forecastSeason([0, 1, 1]).homeWinProbability).toBe(1)
  })
  it('enforces 55/45 on unrounded chances in either direction', () => {
    for (const chance of [0.45, 0.5, 0.55]) expect(isSeasonForecastBalanced(forecastSeason([chance]))).toBe(true)
    for (const chance of [0.44999999, 0.55000001, 0.4, 0.6]) expect(isSeasonForecastBalanced(forecastSeason([chance]))).toBe(false)
  })
  it('normalizes outright chances so joint-champion probability cannot hide a season bias', () => {
    const tied = forecastSeason([0.5, 0.5])
    expect(decisiveSeasonChances(tied)).toEqual({ home: 0.5, away: 0.5 })
    expect(isSeasonForecastBalanced(tied)).toBe(true)
    const biased = { ...tied, homeWinProbability: 0.3, awayWinProbability: 0.2 }
    expect(decisiveSeasonChances(biased)).toEqual({ home: 0.6, away: 0.4 })
    expect(isSeasonForecastBalanced(biased)).toBe(false)
    expect(seasonForecastImbalance(biased)).toBe(0.2)
    expect(isSeasonForecastBalanced({ ...tied, homeWinProbability: 0.275, awayWinProbability: 0.225 })).toBe(true)
    for (const invalid of [forecastSeason([], 3, 3), { ...tied, homeWinProbability: NaN }, { ...tied, awayWinProbability: -0.1 }]) {
      expect(decisiveSeasonChances(invalid)).toBeNull()
      expect(isSeasonForecastBalanced(invalid)).toBe(false)
    }
  })
  it('includes completed results and forfeits, handles reversed home teams, and updates after undo', () => {
    const first = { ...game('one'), status: 'completed' as const, winner_team_id: 'a' }
    const second = { ...game('two', true), status: 'forfeit' as const, winner_team_id: 'b' }
    const third = game('three', true)
    const result = forecastLeagueDuelSeason([first, second, third], ['a', 'b'])!
    expect(result).toMatchObject({ remainingGames: 1, totalGames: 3 })
    expect(result.homeWinProbability).toBeCloseTo(0.5, 7)
    expect(result.expectedHomeWins).toBeCloseTo(1.5, 7)
    const corrected = { ...first, winner_team_id: 'b' }
    expect(forecastLeagueDuelSeason([corrected, second, third], ['a', 'b'])!.awayWinProbability).toBe(1)
    expect(forecastLeagueDuelSeason([game('one'), second, third], ['a', 'b'])!.awayWinProbability).toBeCloseTo(0.75)
    third.home_team.players![0]!.rating = 2000
    const forward = forecastLeagueDuelSeason([third], ['a', 'b'])!
    const reverse = forecastLeagueDuelSeason([third], ['b', 'a'])!
    expect(forward.homeWinProbability).toBeLessThan(0.5)
    expect(forward.homeWinProbability).toBeCloseTo(reverse.awayWinProbability, 12)
  })
  it('does not silently omit games with missing ratings, incomplete lineups, or invalid winners', () => {
    const match = game('one')
    match.home_team.players![0]!.rating = undefined
    expect(forecastLeagueDuelSeason([match], ['a', 'b'])).toBeNull()
    expect(forecastLeagueDuelSeason([{ ...game('one'), away_team: { ...game('one').away_team, players: [] } }], ['a', 'b'])).toBeNull()
    expect(forecastLeagueDuelSeason([{ ...game('one'), status: 'forfeit', winner_team_id: 'other' }], ['a', 'b'])).toBeNull()
    expect(forecastLeagueDuelSeason([game('one')], ['a', 'other'])).toBeNull()
    expect(forecastLeagueDuelSeason([], ['a', 'b'])).toBeNull()
    for (const probabilities of [[NaN], [Infinity], [-0.1], [1.1]]) expect(() => forecastSeason(probabilities)).toThrow()
    expect(() => forecastSeason([], -1)).toThrow()
  })
})

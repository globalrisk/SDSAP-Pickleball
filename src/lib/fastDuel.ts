import { compareDuelPlayers, type LeagueDuelGame } from './leagueDuelSchedule'
import { duelMatchProbabilityLimit, duelScheduleId, hasUniqueDuelMatchups, isDuelRatingDifferenceAllowed, measureDuelSchedule, orderDuelGames, validateDuelSettings, type DuelScheduleOption, type DuelSearchInput, type DuelSplit } from './flexibleDuel'
import { isSeasonForecastBalanced } from './seasonForecast'

/** Recompute every metric and validate received lineups before enabling Save. */
export function decodeFastDuelOption(input: DuelSearchInput, split: DuelSplit, raw: unknown): DuelScheduleOption {
  const value = raw as { kind?: unknown; games?: unknown; solver?: { status?: unknown; elapsedMs?: unknown; coverageProof?: unknown } } | null
  const size = input.pool.length / 2, count = size * (size - 1) / 2, rounds = size - 1 + size % 2
  validateDuelSettings(size, input.settings)
  if (!value || value.kind !== 'variety' || !Array.isArray(value.games) || value.games.length !== count) throw new Error('SOLVER_INVALID_RESULT')
  const solver = value.solver
  if (!solver || (solver.status !== 'FEASIBLE' && solver.status !== 'OPTIMAL') || typeof solver.elapsedMs !== 'number'
    || !Number.isFinite(solver.elapsedMs) || solver.elapsedMs < 0
    || (solver.coverageProof !== undefined && solver.coverageProof !== 'roster' && solver.coverageProof !== 'squads')) throw new Error('SOLVER_INVALID_RESULT')
  const games = value.games as LeagueDuelGame[]
  const sequence = new Set<number>(), appearances = new Map<number, string[]>()
  for (const g of games) {
    if (!g || !Number.isInteger(g.roundNumber) || g.roundNumber < 1 || g.roundNumber > rounds || !Number.isInteger(g.sequenceNumber) || g.sequenceNumber < 1 || g.sequenceNumber > count || sequence.has(g.sequenceNumber)
      || !Array.isArray(g.homePoolPlayerIds) || !Array.isArray(g.awayPoolPlayerIds) || g.homePoolPlayerIds.length !== 2 || g.awayPoolPlayerIds.length !== 2
      || !g.homePoolPlayerIds.every(id => split.squads[0].includes(id)) || !g.awayPoolPlayerIds.every(id => split.squads[1].includes(id))) throw new Error('SOLVER_INVALID_RESULT')
    sequence.add(g.sequenceNumber)
    appearances.set(g.roundNumber, [...appearances.get(g.roundNumber) ?? [], ...g.homePoolPlayerIds, ...g.awayPoolPlayerIds])
  }
  if (!isDuelRatingDifferenceAllowed(input.pool, games, input.settings.maxRatingDifference) || !hasUniqueDuelMatchups(games) || appearances.size !== rounds || [...appearances.values()].some(ids => ids.length !== Math.floor(size / 2) * 4 || new Set(ids).size !== ids.length)) throw new Error('SOLVER_INVALID_RESULT')
  const byId = new Map(input.pool.map(p => [p.id, p]))
  const squads = split.squads.map(side => side.map(id => byId.get(id)!)) as [typeof input.pool, typeof input.pool]
  const ordered = orderDuelGames(games), metrics = measureDuelSchedule(squads, ordered)
  if (metrics.worstFavorite > duelMatchProbabilityLimit(input.settings) + 1e-12 || metrics.players.some(p => p.games !== size - 1) || metrics.maxPartnerMeetings > (input.settings.maxPartnerMeetings ?? size - 1)
    || metrics.maxOpponentMeetings > (input.settings.maxOpponentMeetings ?? size - 1) || !isSeasonForecastBalanced(metrics.forecast)) throw new Error('SOLVER_INVALID_RESULT')
  return { id: duelScheduleId(ordered), kind: 'variety', games: ordered, metrics,
    solver: { status: solver.status, elapsedMs: solver.elapsedMs, coverageProof: solver.coverageProof } }
}

export function fastDuelSplitCount(size: number): number {
  if (!Number.isInteger(size) || size < 4 || size > 7) throw new Error('SOLVER_INVALID_RESULT')
  let count = 1
  for (let i = 0; i < size - 1; i++) count = count * (2 * size - 1 - i) / (i + 1)
  return Math.round(count)
}

/** Validate a canonical proof ID: every accepted ID denotes one unique roster split. */
export function isFastDuelSplitId(input: DuelSearchInput, identity: unknown): identity is string {
  if (typeof identity !== 'string') return false
  const sides = identity.split('|').map(side => side.split(':')), size = input.pool.length / 2
  if (sides.length !== 2 || sides.some(side => side.length !== size) || new Set(sides.flat()).size !== input.pool.length) return false
  const ids = new Set(input.pool.map(p => p.id)), strongest = [...input.pool].sort(compareDuelPlayers)[0]?.id
  return sides.flat().every(id => ids.has(id)) && sides[0]!.includes(strongest!) && identity === sides.map(side => [...side].sort().join(':')).join('|')
}

export function decodeFastDuelSplit(input: DuelSearchInput, raw: unknown): DuelSplit {
  if (!Array.isArray(raw) || raw.length !== 2 || raw.some(side => !Array.isArray(side) || side.some(id => typeof id !== 'string'))) throw new Error('SOLVER_INVALID_RESULT')
  const squads = raw as [string[], string[]], id = squads.map(side => [...side].sort().join(':')).join('|')
  if (!isFastDuelSplitId(input, id)) throw new Error('SOLVER_INVALID_RESULT')
  const pool = new Map(input.pool.map(p => [p.id, p]))
  if (squads.some(side => side.join(':') !== [...side].sort((a, b) => compareDuelPlayers(pool.get(a)!, pool.get(b)!)).join(':'))) throw new Error('SOLVER_INVALID_RESULT')
  return { id, squads }
}

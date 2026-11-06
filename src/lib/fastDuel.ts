import { compareDuelPlayers, type LeagueDuelGame } from './leagueDuelSchedule'
import { duelMatchProbabilityLimit, duelScheduleId, hasUniqueDuelMatchups, measureDuelSchedule, orderDuelGames, validateDuelSettings, type DuelScheduleOption, type DuelSearchInput, type DuelSplit } from './flexibleDuel'
import { isSeasonForecastBalanced } from './seasonForecast'

export function chooseFastDuelSplit(input: DuelSearchInput, current?: DuelSplit, seen: string[] = [], random = Math.random): DuelSplit | undefined {
  const pool = [...input.pool].sort(compareDuelPlayers), size = pool.length / 2
  validateDuelSettings(size, input.settings)
  const candidates: (DuelSplit & { gap: number })[] = []
  function choose(start: number, indices: number[]) {
    if (indices.length === size) {
      const chosen = new Set(indices), squads = [indices.map(i => pool[i]!), pool.filter((_, i) => !chosen.has(i))]
      const ids = squads.map(side => side.map(p => p.id)) as [string[], string[]]
      candidates.push({ id: ids.map(side => [...side].sort().join(':')).join('|'), squads: ids, bestWorst: 1,
        gap: Math.abs(squads[0]!.reduce((s, p) => s + p.rating, 0) - squads[1]!.reduce((s, p) => s + p.rating, 0)) })
      return
    }
    for (let i = start; i <= pool.length - size + indices.length; i++) choose(i + 1, [...indices, i])
  }
  choose(1, [0])
  const minimum = Math.min(...candidates.map(c => c.gap))
  // A wide total-rating window can select squads with no 55/45 schedule.
  // Keep shuffles close to the best total before spending the server budget.
  const eligible = candidates.filter(c => c.gap <= minimum + size * 5)
  let available = eligible.filter(c => !seen.includes(c.id))
  if (!available.length) available = eligible.filter(c => c.id !== current?.id)
  if (!available.length) return current ?? eligible[0]
  if (current) {
    const moved = (s: DuelSplit) => { const count = s.squads[0].filter(id => !current.squads[0].includes(id)).length; return Math.min(count, size - count) }
    const most = Math.max(...available.map(moved)); available = available.filter(c => moved(c) === most)
  }
  return available[Math.min(available.length - 1, Math.floor(random() * available.length))]
}

/** Recompute every metric and validate received lineups before enabling Save. */
export function decodeFastDuelOptions(input: DuelSearchInput, split: DuelSplit, raw: unknown): DuelScheduleOption[] {
  if (!Array.isArray(raw) || raw.length > 3) throw new Error('SOLVER_INVALID_RESULT')
  if (raw.length) validateDuelSettings(input.pool.length / 2, input.settings)
  const byId = new Map(input.pool.map(p => [p.id, p])), squads = split.squads.map(side => side.map(id => byId.get(id)!)) as [typeof input.pool, typeof input.pool]
  const size = squads[0].length, count = size * (size - 1) / 2, rounds = size - 1 + size % 2
  const options = raw.map((value: { kind?: unknown; games?: unknown; solver?: { status?: unknown; elapsedMs?: unknown } }) => {
    if (!value || !['balance', 'variety', 'experience'].includes(String(value.kind)) || !Array.isArray(value.games) || value.games.length !== count) throw new Error('SOLVER_INVALID_RESULT')
    const games = value.games as LeagueDuelGame[]
    const sequence = new Set<number>(), appearances = new Map<number, string[]>()
    for (const g of games) {
      if (!g || !Number.isInteger(g.roundNumber) || g.roundNumber < 1 || g.roundNumber > rounds || !Number.isInteger(g.sequenceNumber) || g.sequenceNumber < 1 || g.sequenceNumber > count || sequence.has(g.sequenceNumber)
        || !Array.isArray(g.homePoolPlayerIds) || !Array.isArray(g.awayPoolPlayerIds) || g.homePoolPlayerIds.length !== 2 || g.awayPoolPlayerIds.length !== 2
        || !g.homePoolPlayerIds.every(id => split.squads[0].includes(id)) || !g.awayPoolPlayerIds.every(id => split.squads[1].includes(id))) throw new Error('SOLVER_INVALID_RESULT')
      sequence.add(g.sequenceNumber)
      appearances.set(g.roundNumber, [...appearances.get(g.roundNumber) ?? [], ...g.homePoolPlayerIds, ...g.awayPoolPlayerIds])
    }
    if (!hasUniqueDuelMatchups(games) || appearances.size !== rounds || [...appearances.values()].some(ids => ids.length !== Math.floor(size / 2) * 4 || new Set(ids).size !== ids.length)) throw new Error('SOLVER_INVALID_RESULT')
    const ordered = orderDuelGames(games), metrics = measureDuelSchedule(squads, ordered)
    if (metrics.worstFavorite > duelMatchProbabilityLimit(input.settings) + 1e-12 || metrics.players.some(p => p.games !== size - 1) || metrics.maxPartnerMeetings > (input.settings.maxPartnerMeetings ?? size - 1)
      || metrics.maxOpponentMeetings > (input.settings.maxOpponentMeetings ?? size - 1) || !isSeasonForecastBalanced(metrics.forecast)
      || !['OPTIMAL', 'FEASIBLE'].includes(String(value.solver?.status)) || !Number.isFinite(value.solver?.elapsedMs)) throw new Error('SOLVER_INVALID_RESULT')
    return { id: duelScheduleId(ordered), kind: value.kind, games: ordered, metrics, solver: value.solver } as DuelScheduleOption
  })
  if (new Set(options.map(o => o.id)).size !== options.length || (options.length && options[0]!.kind !== 'balance')
    || options.some(o => o.metrics.worstFavorite > options[0]!.metrics.worstFavorite + .05 + 1e-12)) throw new Error('SOLVER_INVALID_RESULT')
  const hardest = (o: DuelScheduleOption) => [Math.max(...o.metrics.players.map(p => p.below40)), Math.max(...o.metrics.players.map(p => p.disadvantage))]
  const baseline = options[0] ? hardest(options[0]) : []
  for (const o of options) if (o.kind === 'experience') { const score = hardest(o); if (score[0]! > baseline[0]! || score[0] === baseline[0] && score[1]! >= baseline[1]! - 1e-12) o.kind = 'alternative' }
  return options
}

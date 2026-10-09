import { partnershipKey } from './balanceTeams'
import type { DuelDraftPriority, MatchWithTeams, PoolPlayer } from '../types'
import { assignLeagueDuelTiers, buildTierMatchedDuelSchedules, compareDuelPlayers, compareOpponentEncounters, duelTierCounts, type LeagueDuelSchedule } from './leagueDuelSchedule'
import { isSeasonForecastBalanced, seasonForecastImbalance } from './seasonForecast'

export { LEAGUE_DUEL_ROSTER_SIZES } from './leagueDuelSchedule'

export interface LeagueDuelDraft {
  id: string
  splitId: string
  priority: DuelDraftPriority
  squads: [PoolPlayer[], PoolPlayer[]]
  worstFavorite: number
  repeatedPartnerships: number
  partnerHistoryOccurrences: number
  recentPartnerRepeats: number[]
  opponentRepeats: number
  schedule: LeagueDuelSchedule
}

/** Enumerate each split once, with the strongest player anchoring side A. */
export function generateLeagueDuelDrafts(
  pool: PoolPlayer[],
  partnerHistory: readonly ReadonlySet<string>[] = [],
): LeagueDuelDraft[] {
  const candidates = generateLeagueDuelDraftCandidates(pool, partnerHistory)
  return [candidates.balance[0], candidates.opponent_variety[0]].filter((draft): draft is LeagueDuelDraft => !!draft)
}

export type LeagueDuelDraftCandidates = Record<DuelDraftPriority, LeagueDuelDraft[]>

function compareHistory(a: LeagueDuelDraft, b: LeagueDuelDraft): number {
  return a.repeatedPartnerships - b.repeatedPartnerships
    || a.partnerHistoryOccurrences - b.partnerHistoryOccurrences
    || a.recentPartnerRepeats[0]! - b.recentPartnerRepeats[0]!
    || a.recentPartnerRepeats[1]! - b.recentPartnerRepeats[1]!
    || a.recentPartnerRepeats[2]! - b.recentPartnerRepeats[2]!
}

export function compareLeagueDuelDrafts(a: LeagueDuelDraft, b: LeagueDuelDraft): number {
  const variety = compareOpponentEncounters(a.schedule.opponentEncounterCounts, b.schedule.opponentEncounterCounts)
  const balance = a.worstFavorite - b.worstFavorite || a.schedule.totalImbalance - b.schedule.totalImbalance
  const seasonBalance = seasonForecastImbalance(a.schedule.seasonForecast) - seasonForecastImbalance(b.schedule.seasonForecast)
  return (a.priority === 'balance' ? seasonBalance || balance || compareHistory(a, b) || variety
    : variety || seasonBalance || compareHistory(a, b) || balance) || a.id.localeCompare(b.id)
}

/** Return ranked alternatives inside the agreed quality bounds for each priority. */
export function generateLeagueDuelDraftCandidates(
  pool: PoolPlayer[], partnerHistory: readonly ReadonlySet<string>[] = [],
): LeagueDuelDraftCandidates {
  const tiers = assignLeagueDuelTiers(pool)
  const sorted = [...pool].sort(compareDuelPlayers)
  const size = sorted.length / 2
  const required = duelTierCounts(size)
  const history = partnerHistory.slice(0, 3)
  const drafts: LeagueDuelDraft[] = []
  function visit(start: number, indices: number[]) {
    if (indices.length === size) {
      const counts = ['top', 'middle', 'bottom'].map((tier) => indices.filter((i) => tiers.get(sorted[i]!.id) === tier).length)
      if (counts.some((count, i) => count !== required[i])) return
      const chosen = new Set(indices)
      const squads: [PoolPlayer[], PoolPlayer[]] = [indices.map((i) => sorted[i]!), sorted.filter((_, i) => !chosen.has(i))]
      let repeatedPartnerships = 0, partnerHistoryOccurrences = 0
      const recentPartnerRepeats = [0, 0, 0]
      for (let i = 0; i < size; i++) {
        for (let j = i + 1; j < size; j++) {
          for (const squad of squads) {
            const key = partnershipKey(squad[i]!.id, squad[j]!.id)
            let occurrences = 0
            history.forEach((season, index) => {
              if (season.has(key)) { occurrences++; recentPartnerRepeats[index]!++ }
            })
            if (occurrences) repeatedPartnerships++
            partnerHistoryOccurrences += occurrences
          }
        }
      }
      const schedules = buildTierMatchedDuelSchedules(squads)
      const splitId = squads.map((squad) => squad.map((p) => p.id).sort().join(':')).join('|')
      for (const priority of ['balance', 'opponent_variety'] as const) {
        const schedule = schedules[priority]
        drafts.push({ id: `${priority}|${splitId}`, splitId, priority,
          squads, repeatedPartnerships, partnerHistoryOccurrences, recentPartnerRepeats, schedule,
          worstFavorite: schedule.worstFavorite, opponentRepeats: schedule.opponentRepeats })
      }
      return
    }
    for (let i = start; i <= sorted.length - (size - indices.length); i++) visit(i + 1, [...indices, i])
  }
  visit(1, [0])
  const balancedDrafts = drafts.filter((draft) => draft.priority === 'balance')
  const bestWorstFavorite = Math.min(...balancedDrafts.map(draft => draft.worstFavorite))
  const balance = balancedDrafts.filter(draft => draft.worstFavorite <= bestWorstFavorite + 0.05 + 1e-12).sort(compareLeagueDuelDrafts)
  const variety = drafts.filter((draft) => draft.priority === 'opponent_variety').sort(compareLeagueDuelDrafts)
  const optimalVariety = variety.filter(draft => compareOpponentEncounters(draft.schedule.opponentEncounterCounts, variety[0]!.schedule.opponentEncounterCounts) === 0)
  const bestRepeatedPartnerships = Math.min(...optimalVariety.map(draft => draft.repeatedPartnerships))
  return {
    balance: balance.filter(draft => isSeasonForecastBalanced(draft.schedule.seasonForecast)),
    opponent_variety: optimalVariety.filter(draft => draft.repeatedPartnerships <= bestRepeatedPartnerships + 6
      && isSeasonForecastBalanced(draft.schedule.seasonForecast)),
  }
}

export function getLeagueDuelProgress(matches: MatchWithTeams[]) {
  const remaining = matches.filter((m) => m.status === 'scheduled').length
  const wins = new Map<string, number>()
  for (const match of matches) if (match.status !== 'scheduled' && match.winner_team_id) {
    wins.set(match.winner_team_id, (wins.get(match.winner_team_id) ?? 0) + 1)
  }
  const sides = [...new Set(matches.flatMap((m) => [m.home_team_id, m.away_team_id]))]
  const clinchedTeamId = sides.find((id) => (wins.get(id) ?? 0) > (wins.get(sides.find((other) => other !== id) ?? '') ?? 0) + remaining) ?? null
  return { remaining, wins, clinchedTeamId, complete: matches.length > 0 && remaining === 0,
    tied: matches.length > 0 && remaining === 0 && sides.length === 2 && (wins.get(sides[0]!) ?? 0) === (wins.get(sides[1]!) ?? 0) }
}

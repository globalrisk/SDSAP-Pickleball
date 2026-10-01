import { teamWinProbability, type SkillRating } from './ratings'
import { partnershipKey } from './balanceTeams'
import type { MatchWithTeams, PoolPlayer, TeamWithPlayers } from '../types'

export const DUEL_BALANCE_TARGET = 0.65
export const LEAGUE_DUEL_ROSTER_SIZES = [8, 10, 12, 14] as const

export interface LeagueDuelDraft {
  id: string
  squads: [PoolPlayer[], PoolPlayer[]]
  worstFavorite: number
  repeatedSquadmates: number
  meetsTarget: boolean
}

/** Enumerate each split once, with the strongest player anchoring side A. */
export function generateLeagueDuelDrafts(
  pool: PoolPlayer[],
  squadmateCounts: ReadonlyMap<string, number> = new Map(),
): LeagueDuelDraft[] {
  if (!(LEAGUE_DUEL_ROSTER_SIZES as readonly number[]).includes(pool.length)) {
    throw new Error('Select 8, 10, 12, or 14 players for Team Duel.')
  }
  if (new Set(pool.map((p) => p.id)).size !== pool.length
    || pool.some((p) => p.status !== 'active' || !Number.isFinite(p.rating)
      || !Number.isFinite(p.rating_deviation) || p.rating_deviation < 0)) {
    throw new Error('Team Duel requires distinct active players with valid ratings.')
  }
  const sorted = [...pool].sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))
  const size = sorted.length / 2
  const drafts: LeagueDuelDraft[] = []
  const toSkill = (p: PoolPlayer): SkillRating => ({ rating: p.rating, rd: p.rating_deviation, volatility: 0 })
  function visit(start: number, indices: number[]) {
    if (indices.length === size) {
      const chosen = new Set(indices)
      const squads: [PoolPlayer[], PoolPlayer[]] = [indices.map((i) => sorted[i]!), sorted.filter((_, i) => !chosen.has(i))]
      let worstFavorite = 0.5
      let repeatedSquadmates = 0
      for (let i = 0; i < size; i++) {
        for (let j = i + 1; j < size; j++) {
          const probability = teamWinProbability(
            [toSkill(squads[0][i]!), toSkill(squads[0][j]!)],
            [toSkill(squads[1][i]!), toSkill(squads[1][j]!)],
          )!
          worstFavorite = Math.max(worstFavorite, probability, 1 - probability)
          for (const squad of squads) repeatedSquadmates += squadmateCounts.get(partnershipKey(squad[i]!.id, squad[j]!.id)) ?? 0
        }
      }
      drafts.push({
        id: squads.map((squad) => squad.map((p) => p.id).sort().join(':')).join('|'),
        squads, worstFavorite, repeatedSquadmates, meetsTarget: worstFavorite <= DUEL_BALANCE_TARGET,
      })
      return
    }
    for (let i = start; i <= sorted.length - (size - indices.length); i++) visit(i + 1, [...indices, i])
  }
  visit(1, [0])
  const eligible = drafts.filter((draft) => draft.meetsTarget)
  return (eligible.length ? eligible : drafts).sort((a, b) =>
    (eligible.length ? a.repeatedSquadmates - b.repeatedSquadmates : 0)
    || a.worstFavorite - b.worstFavorite
    || a.repeatedSquadmates - b.repeatedSquadmates
    || a.id.localeCompare(b.id),
  ).slice(0, 3)
}

export function countRecentSquadmates(seasons: TeamWithPlayers[][]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const squads of seasons.slice(0, 3)) for (const squad of squads) {
    for (let i = 0; i < squad.players.length; i++) for (let j = i + 1; j < squad.players.length; j++) {
      const key = partnershipKey(squad.players[i]!.pool_player_id, squad.players[j]!.pool_player_id)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
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

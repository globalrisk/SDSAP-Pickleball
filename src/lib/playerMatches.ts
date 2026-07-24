import type { MatchWithTeams, PlayerMatchEvent } from '../types'

export interface NamedPoolPlayer {
  id: string
  name: string
}

/**
 * Resolve home/away pool player IDs from snapshots, falling back to current roster.
 */
export function resolveMatchLineups(match: MatchWithTeams): {
  homeIds: string[]
  awayIds: string[]
} {
  const homeFromSnapshot = match.home_pool_player_ids ?? []
  const awayFromSnapshot = match.away_pool_player_ids ?? []

  const homeIds =
    homeFromSnapshot.length > 0
      ? homeFromSnapshot
      : (match.home_team.players ?? []).map((player) => player.pool_player_id)
  const awayIds =
    awayFromSnapshot.length > 0
      ? awayFromSnapshot
      : (match.away_team.players ?? []).map((player) => player.pool_player_id)

  return { homeIds, awayIds }
}

export function scoreLabelForMatch(match: MatchWithTeams): string | null {
  if (match.home_score == null || match.away_score == null) return null
  return `${match.home_score}-${match.away_score}`
}

/**
 * Build per-player completed-match events for one pool player.
 * Forfeits are excluded (ratings / rivalries / awards).
 */
export function buildPlayerMatchEvents(args: {
  poolPlayerId: string
  matches: MatchWithTeams[]
  nameById: Map<string, string>
  seasonNameById?: Map<string, string>
}): PlayerMatchEvent[] {
  const { poolPlayerId, matches, nameById, seasonNameById } = args
  const events: PlayerMatchEvent[] = []

  for (const match of matches) {
    if (match.status !== 'completed' || !match.winner_team_id) continue

    const { homeIds, awayIds } = resolveMatchLineups(match)
    const onHome = homeIds.includes(poolPlayerId)
    const onAway = awayIds.includes(poolPlayerId)
    if (!onHome && !onAway) continue

    const sideIds = onHome ? homeIds : awayIds
    const foeIds = onHome ? awayIds : homeIds
    const won =
      (onHome && match.winner_team_id === match.home_team_id) ||
      (!onHome && match.winner_team_id === match.away_team_id)

    const partnerPoolId = sideIds.find((id) => id !== poolPlayerId) ?? null

    events.push({
      matchId: match.id,
      seasonId: match.season_id,
      seasonName: seasonNameById?.get(match.season_id) ?? null,
      result: won ? 'W' : 'L',
      partnerPoolId,
      partnerName: partnerPoolId ? (nameById.get(partnerPoolId) ?? '?') : null,
      opponentPoolIds: foeIds,
      opponentNames: foeIds.map((id) => nameById.get(id) ?? '?'),
      scoreLabel: scoreLabelForMatch(match),
      resultRecordedAt: match.result_recorded_at,
      homeTeamId: match.home_team_id,
      awayTeamId: match.away_team_id,
      winnerTeamId: match.winner_team_id,
      onHome,
    })
  }

  return events.sort((a, b) => {
    const dateDiff = (a.resultRecordedAt ?? '').localeCompare(b.resultRecordedAt ?? '')
    if (dateDiff !== 0) return dateDiff
    return a.matchId.localeCompare(b.matchId)
  })
}

export function buildAllPlayerMatchEvents(args: {
  matches: MatchWithTeams[]
  nameById: Map<string, string>
  seasonNameById?: Map<string, string>
}): Map<string, PlayerMatchEvent[]> {
  const byPlayer = new Map<string, PlayerMatchEvent[]>()
  const playerIds = new Set<string>()

  for (const match of args.matches) {
    if (match.status !== 'completed') continue
    const { homeIds, awayIds } = resolveMatchLineups(match)
    for (const id of [...homeIds, ...awayIds]) playerIds.add(id)
  }

  for (const poolPlayerId of playerIds) {
    byPlayer.set(
      poolPlayerId,
      buildPlayerMatchEvents({
        poolPlayerId,
        matches: args.matches,
        nameById: args.nameById,
        seasonNameById: args.seasonNameById,
      }),
    )
  }

  return byPlayer
}

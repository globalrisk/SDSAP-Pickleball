import type { MatchWithTeams, StandingRow, Team, TeamWithPlayers } from '../types'

const FINISHED_STATUSES = new Set(['completed', 'forfeit'])

interface TeamStats {
  team: Team
  playerNames: string[]
  players: { name: string; poolPlayerId: string }[]
  played: number
  wins: number
  losses: number
  points: number
}

/**
 * Split a points-tied group into ordered rank blocks using only matches played
 * within that group. Mini-table wins are compared first, followed by point
 * differential from scored matches in the same group. Equal results are
 * reapplied to the smaller subgroup; if no split is possible, every team in
 * the group shares a rank.
 */
function resolveTieGroup(group: TeamStats[], matches: MatchWithTeams[]): TeamStats[][] {
  if (group.length <= 1) return [group]

  const teamIds = new Set(group.map((row) => row.team.id))
  const headToHeadWins = new Map(group.map((row) => [row.team.id, 0]))
  const headToHeadDifferential = new Map(group.map((row) => [row.team.id, 0]))

  for (const match of matches) {
    if (!FINISHED_STATUSES.has(match.status) || !match.winner_team_id) continue
    if (!teamIds.has(match.home_team_id) || !teamIds.has(match.away_team_id)) continue

    headToHeadWins.set(
      match.winner_team_id,
      (headToHeadWins.get(match.winner_team_id) ?? 0) + 1,
    )

    if (match.home_score != null && match.away_score != null) {
      const margin = match.home_score - match.away_score
      headToHeadDifferential.set(
        match.home_team_id,
        (headToHeadDifferential.get(match.home_team_id) ?? 0) + margin,
      )
      headToHeadDifferential.set(
        match.away_team_id,
        (headToHeadDifferential.get(match.away_team_id) ?? 0) - margin,
      )
    }
  }

  const groupsByRecord = new Map<string, TeamStats[]>()
  for (const row of group) {
    const wins = headToHeadWins.get(row.team.id) ?? 0
    const differential = headToHeadDifferential.get(row.team.id) ?? 0
    const key = `${wins}:${differential}`
    const partition = groupsByRecord.get(key) ?? []
    partition.push(row)
    groupsByRecord.set(key, partition)
  }

  if (groupsByRecord.size === 1) {
    return [[...group].sort((a, b) => a.team.id.localeCompare(b.team.id))]
  }

  return [...groupsByRecord.values()]
    .sort((groupA, groupB) => {
      const teamAId = groupA[0].team.id
      const teamBId = groupB[0].team.id
      const winsDifference =
        (headToHeadWins.get(teamBId) ?? 0) - (headToHeadWins.get(teamAId) ?? 0)
      if (winsDifference !== 0) return winsDifference
      return (
        (headToHeadDifferential.get(teamBId) ?? 0) -
        (headToHeadDifferential.get(teamAId) ?? 0)
      )
    })
    .flatMap((partition) => resolveTieGroup(partition, matches))
}

export function computeStandings(
  teams: TeamWithPlayers[],
  matches: MatchWithTeams[],
): StandingRow[] {
  const stats = new Map(
    teams.map((team) => [
      team.id,
      {
        team,
        playerNames: team.players.map((player) => player.name),
        players: team.players.map((player) => ({
          name: player.name,
          poolPlayerId: player.pool_player_id,
        })),
        played: 0,
        wins: 0,
        losses: 0,
        points: 0,
      },
    ]),
  )

  for (const match of matches) {
    if (!FINISHED_STATUSES.has(match.status) || !match.winner_team_id) continue

    const winner = stats.get(match.winner_team_id)
    const loserId =
      match.winner_team_id === match.home_team_id
        ? match.away_team_id
        : match.home_team_id
    const loser = stats.get(loserId)

    if (winner) {
      winner.played += 1
      winner.wins += 1
      winner.points += 1
    }
    if (loser) {
      loser.played += 1
      loser.losses += 1
    }
  }

  const groupsByPoints = new Map<number, TeamStats[]>()
  for (const row of stats.values()) {
    const group = groupsByPoints.get(row.points) ?? []
    group.push(row)
    groupsByPoints.set(row.points, group)
  }

  const rankBlocks = [...groupsByPoints.entries()]
    .sort(([pointsA], [pointsB]) => pointsB - pointsA)
    .flatMap(([, group]) => resolveTieGroup(group, matches))

  let nextRank = 1
  return rankBlocks.flatMap((block) => {
    const rank = nextRank
    nextRank += block.length
    return block.map((row) => ({ ...row, rank }))
  })
}

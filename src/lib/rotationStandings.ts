import type {
  RotationMatch,
  RotationPlayer,
  RotationStanding,
} from './rotationTypes'

export function validateRotationScore(teamAScore: number, teamBScore: number): void {
  if (
    !Number.isInteger(teamAScore) ||
    !Number.isInteger(teamBScore) ||
    teamAScore < 0 ||
    teamBScore < 0
  ) {
    throw new Error('Scores must be non-negative whole numbers.')
  }
  if (teamAScore === teamBScore) throw new Error('Match scores cannot be tied.')
  if (Math.max(teamAScore, teamBScore) < 11) {
    throw new Error('The winning team must score at least 11 points.')
  }
  if (Math.abs(teamAScore - teamBScore) < 2) {
    throw new Error('The winning team must lead by at least 2 points.')
  }
}

export function compareRotationStandings(a: RotationStanding, b: RotationStanding): number {
  return (
    b.wins - a.wins ||
    b.pointDifferential - a.pointDifferential ||
    b.pointsFor - a.pointsFor ||
    b.opponentsWinRate - a.opponentsWinRate ||
    a.name.localeCompare(b.name)
  )
}

export function getRotationPodium(
  standings: readonly RotationStanding[],
  isComplete: boolean,
): RotationStanding[] {
  return isComplete ? standings.slice(0, 3) : []
}

export function buildRotationStandings(
  players: readonly RotationPlayer[],
  matches: readonly RotationMatch[],
): RotationStanding[] {
  const rows = new Map<string, Omit<RotationStanding, 'rank' | 'opponentsWinRate'> & {
    opponentIds: string[]
  }>()
  for (const player of players) {
    rows.set(player.id, {
      playerId: player.id,
      name: player.name,
      played: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 0,
      opponentIds: [],
    })
  }

  for (const match of matches) {
    if (
      match.status !== 'completed' ||
      match.team_a_score == null ||
      match.team_b_score == null
    ) {
      continue
    }
    const teamA = [match.team_a_player_1_id, match.team_a_player_2_id]
    const teamB = [match.team_b_player_1_id, match.team_b_player_2_id]
    const teamAWon = match.team_a_score > match.team_b_score
    for (const [team, opponents, pointsFor, pointsAgainst, won] of [
      [teamA, teamB, match.team_a_score, match.team_b_score, teamAWon],
      [teamB, teamA, match.team_b_score, match.team_a_score, !teamAWon],
    ] as const) {
      for (const playerId of team) {
        const row = rows.get(playerId)
        if (!row) continue
        row.played += 1
        row.wins += Number(won)
        row.losses += Number(!won)
        row.pointsFor += pointsFor
        row.pointsAgainst += pointsAgainst
        row.pointDifferential = row.pointsFor - row.pointsAgainst
        row.opponentIds.push(...opponents)
      }
    }
  }

  const winRates = new Map(
    [...rows.values()].map((row) => [
      row.playerId,
      row.played > 0 ? row.wins / row.played : 0,
    ]),
  )
  return [...rows.values()]
    .map(({ opponentIds, ...row }) => ({
      ...row,
      rank: 0,
      opponentsWinRate:
        opponentIds.length > 0
          ? opponentIds.reduce((sum, id) => sum + (winRates.get(id) ?? 0), 0) /
            opponentIds.length
          : 0,
    }))
    .sort(compareRotationStandings)
    .map((row, index) => ({ ...row, rank: index + 1 }))
}

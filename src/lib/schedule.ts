/**
 * Circle-method round robin for any number of teams.
 *
 * Odd-sized leagues are padded with a virtual bye. Pairings that contain the
 * bye are omitted, leaving each real team with one bye round while still
 * scheduling every pair of teams exactly once.
 */
export function generateRoundRobinPairings(teamCount: number): [number, number][][] {
  if (!Number.isInteger(teamCount) || teamCount < 2) {
    throw new Error('Need at least 2 teams to create matches')
  }

  const rotationSize = teamCount + (teamCount % 2)
  const byeIndex = teamCount
  const teams = Array.from({ length: rotationSize }, (_, i) => i)
  const rounds: [number, number][][] = []

  for (let round = 0; round < rotationSize - 1; round++) {
    const pairings: [number, number][] = []
    for (let i = 0; i < rotationSize / 2; i++) {
      const home = teams[i]
      const away = teams[rotationSize - 1 - i]
      if (home === byeIndex || away === byeIndex) continue
      pairings.push([home, away])
    }
    rounds.push(pairings)

    const fixed = teams[0]
    const rest = teams.slice(1)
    rest.unshift(rest.pop()!)
    teams.splice(0, teams.length, fixed, ...rest)
  }

  return rounds
}

export interface GeneratedMatchRow {
  season_id: string
  home_team_id: string
  away_team_id: string
  round_number: number
  status: 'scheduled'
}

export function buildRoundRobinMatches(
  seasonId: string,
  teamIds: string[],
): GeneratedMatchRow[] {
  if (teamIds.length < 2) {
    throw new Error('Need at least 2 teams to create matches')
  }

  const rounds = generateRoundRobinPairings(teamIds.length)
  const matches: GeneratedMatchRow[] = []

  rounds.forEach((pairings, roundIndex) => {
    for (const [homeIndex, awayIndex] of pairings) {
      matches.push({
        season_id: seasonId,
        home_team_id: teamIds[homeIndex],
        away_team_id: teamIds[awayIndex],
        round_number: roundIndex + 1,
        status: 'scheduled',
      })
    }
  })

  return matches
}

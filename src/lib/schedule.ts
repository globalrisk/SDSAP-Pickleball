/** Circle-method round robin for an even number of teams. */
export function generateRoundRobinPairings(teamCount: number): [number, number][][] {
  if (teamCount % 2 !== 0) {
    throw new Error('Round robin requires an even number of teams')
  }

  const teams = Array.from({ length: teamCount }, (_, i) => i)
  const rounds: [number, number][][] = []

  for (let round = 0; round < teamCount - 1; round++) {
    const pairings: [number, number][] = []
    for (let i = 0; i < teamCount / 2; i++) {
      const home = teams[i]
      const away = teams[teamCount - 1 - i]
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
  scheduled_at: string
  round_number: number
  status: 'scheduled'
}

/** Next date at 18:00 local time, at least one day ahead, then weekly rounds. */
export function firstRoundStartDate(from = new Date()): Date {
  const start = new Date(from)
  start.setDate(start.getDate() + 1)
  start.setHours(18, 0, 0, 0)
  return start
}

export function buildRoundRobinMatches(
  seasonId: string,
  teamIds: string[],
  startDate: Date = firstRoundStartDate(),
): GeneratedMatchRow[] {
  if (teamIds.length < 2) {
    throw new Error('Need at least 2 teams to create matches')
  }
  if (teamIds.length % 2 !== 0) {
    throw new Error('Round robin requires an even number of teams')
  }

  const rounds = generateRoundRobinPairings(teamIds.length)
  const matches: GeneratedMatchRow[] = []

  rounds.forEach((pairings, roundIndex) => {
    const scheduled = new Date(startDate)
    scheduled.setDate(startDate.getDate() + roundIndex * 7)

    for (const [homeIndex, awayIndex] of pairings) {
      matches.push({
        season_id: seasonId,
        home_team_id: teamIds[homeIndex],
        away_team_id: teamIds[awayIndex],
        scheduled_at: scheduled.toISOString(),
        round_number: roundIndex + 1,
        status: 'scheduled',
      })
    }
  })

  return matches
}

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

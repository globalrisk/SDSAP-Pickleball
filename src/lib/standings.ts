import type { MatchWithTeams, StandingRow, Team } from '../types'

const FINISHED_STATUSES = new Set(['completed', 'forfeit'])

interface HeadToHeadResult {
  winnerId: string
}

interface TeamStats {
  team: Team
  played: number
  wins: number
  losses: number
  points: number
}

function pairKey(teamAId: string, teamBId: string): string {
  return teamAId < teamBId ? `${teamAId}:${teamBId}` : `${teamBId}:${teamAId}`
}

function buildHeadToHeadMap(matches: MatchWithTeams[]): Map<string, HeadToHeadResult> {
  const map = new Map<string, HeadToHeadResult>()

  for (const match of matches) {
    if (!FINISHED_STATUSES.has(match.status) || !match.winner_team_id) continue

    map.set(pairKey(match.home_team_id, match.away_team_id), {
      winnerId: match.winner_team_id,
    })
  }

  return map
}

function getHeadToHead(
  teamAId: string,
  teamBId: string,
  headToHeadMap: Map<string, HeadToHeadResult>,
): HeadToHeadResult | null {
  return headToHeadMap.get(pairKey(teamAId, teamBId)) ?? null
}

function compareTeams(
  a: TeamStats,
  b: TeamStats,
  headToHeadMap: Map<string, HeadToHeadResult>,
): number {
  if (b.points !== a.points) return b.points - a.points

  const headToHead = getHeadToHead(a.team.id, b.team.id, headToHeadMap)
  if (headToHead) {
    if (headToHead.winnerId === a.team.id) return -1
    if (headToHead.winnerId === b.team.id) return 1
  }

  if (b.wins !== a.wins) return b.wins - a.wins
  return a.team.id.localeCompare(b.team.id)
}

function areStandingsTied(
  a: TeamStats,
  b: TeamStats,
  headToHeadMap: Map<string, HeadToHeadResult>,
): boolean {
  if (a.points !== b.points) return false
  return getHeadToHead(a.team.id, b.team.id, headToHeadMap) === null
}

export function computeStandings(teams: Team[], matches: MatchWithTeams[]): StandingRow[] {
  const stats = new Map(
    teams.map((team) => [
      team.id,
      { team, played: 0, wins: 0, losses: 0, points: 0 },
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

  const headToHeadMap = buildHeadToHeadMap(matches)
  const sorted = [...stats.values()].sort((a, b) => compareTeams(a, b, headToHeadMap))

  let currentRank = 0
  return sorted.map((row, index) => {
    const prev = sorted[index - 1]
    if (index === 0 || !areStandingsTied(row, prev, headToHeadMap)) {
      currentRank = index + 1
    }
    return { ...row, rank: currentRank }
  })
}

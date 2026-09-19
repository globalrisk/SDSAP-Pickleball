import type {
  GeneratedTeamDuelMatch,
  GeneratedTeamDuelRound,
  TeamDuelMatch,
  TeamDuelScore,
  TeamDuelSide,
} from './teamDuelTypes'

export const SUPPORTED_TEAM_DUEL_SIZES = [4, 5, 6] as const

export function isSupportedTeamDuelSize(size: number): size is 4 | 5 | 6 {
  return SUPPORTED_TEAM_DUEL_SIZES.includes(size as 4 | 5 | 6)
}

export function generateTeamDuelSchedule(size: number): GeneratedTeamDuelRound[] {
  if (!isSupportedTeamDuelSize(size)) {
    throw new Error('Team Duel squads must contain 4, 5, or 6 players.')
  }

  const rotation: (number | null)[] = Array.from({ length: size }, (_, index) => index + 1)
  if (size % 2 === 1) rotation.push(null)

  const roundCount = rotation.length - 1
  const rounds: GeneratedTeamDuelRound[] = []
  let sequenceNumber = 1
  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const matches: GeneratedTeamDuelMatch[] = []
    let byeRank: number | null = null
    for (let pairIndex = 0; pairIndex < rotation.length / 2; pairIndex += 1) {
      const first = rotation[pairIndex]
      const second = rotation[rotation.length - 1 - pairIndex]
      if (first == null || second == null) {
        byeRank = first ?? second ?? null
        continue
      }
      matches.push({
        roundNumber: roundIndex + 1,
        sequenceNumber,
        rankPair: [first, second],
      })
      sequenceNumber += 1
    }
    rounds.push({ roundNumber: roundIndex + 1, byeRank, matches })

    const fixed = rotation[0]
    const last = rotation[rotation.length - 1]
    rotation.splice(0, rotation.length, fixed, last, ...rotation.slice(1, -1))
  }
  return rounds
}

export function flattenTeamDuelSchedule(size: number): GeneratedTeamDuelMatch[] {
  return generateTeamDuelSchedule(size).flatMap((round) => round.matches)
}

export function validateTeamDuelScore(teamAScore: number, teamBScore: number): void {
  if (!Number.isInteger(teamAScore) || !Number.isInteger(teamBScore)) {
    throw new Error('Scores must be whole numbers.')
  }
  if (teamAScore < 0 || teamBScore < 0 || teamAScore === teamBScore) {
    throw new Error('Scores must be nonnegative and cannot be tied.')
  }
  if (Math.max(teamAScore, teamBScore) < 11 || Math.abs(teamAScore - teamBScore) < 2) {
    throw new Error('A standard game requires at least 11 points and a 2-point margin.')
  }
}

export function getTeamDuelScore(matches: readonly TeamDuelMatch[]): TeamDuelScore {
  let teamA = 0
  let teamB = 0
  let completed = 0
  for (const match of matches) {
    if (match.status !== 'completed' || match.team_a_score == null || match.team_b_score == null) {
      continue
    }
    completed += 1
    if (match.team_a_score > match.team_b_score) teamA += 1
    else teamB += 1
  }
  return { teamA, teamB, completed, total: matches.length }
}

function sideRanks(match: TeamDuelMatch, side: TeamDuelSide): readonly number[] {
  return side === 'a'
    ? [match.team_a_rank_1, match.team_a_rank_2]
    : [match.team_b_rank_1, match.team_b_rank_2]
}

function sharesPlayer(first: TeamDuelMatch, second: TeamDuelMatch): boolean {
  return (['a', 'b'] as const).some((side) => {
    const firstRanks = new Set(sideRanks(first, side))
    return sideRanks(second, side).some((rank) => firstRanks.has(rank))
  })
}

export function getStartableTeamDuelMatches(
  matches: readonly TeamDuelMatch[],
  courtCount: number,
): TeamDuelMatch[] {
  const playing = matches.filter((match) => match.status === 'playing')
  const openCourts = Math.max(0, courtCount - playing.length)
  if (openCourts === 0) return []

  const selected: TeamDuelMatch[] = []
  const ordered = matches
    .filter((match) => match.status === 'available')
    .toSorted(
      (first, second) =>
        first.round_number - second.round_number || first.sequence_number - second.sequence_number,
    )
  for (const match of ordered) {
    if (playing.some((active) => sharesPlayer(active, match))) continue
    if (selected.some((chosen) => sharesPlayer(chosen, match))) continue
    selected.push(match)
    if (selected.length === openCourts) break
  }
  return selected
}

export function teamDuelPlayerName(
  players: ReadonlyMap<string, string>,
  side: TeamDuelSide,
  rank: number,
): string {
  return players.get(`${side}:${rank}`) ?? `#${rank}`
}

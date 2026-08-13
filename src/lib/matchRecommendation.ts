import { areAllMatchPlayersPresent } from './tournamentMode'
import type { MatchWithTeams, StandingRow } from '../types'

interface CandidateScore {
  match: MatchWithTeams
  projectedSpread: number
  backToBackTeams: number
  minimumRest: number
  restDifference: number
  totalRest: number
  standingImpact: number
}

function standingsImpact(
  match: MatchWithTeams,
  standings: StandingRow[],
) {
  if (standings.length === 0) return 0

  const currentRanks = new Map(standings.map((row) => [row.team.id, row.rank]))
  const points = new Map(standings.map((row) => [row.team.id, row.points]))

  function impactWhen(winnerTeamId: string) {
    const simulated = standings
      .map((row) => ({
        teamId: row.team.id,
        points: (points.get(row.team.id) ?? 0) + (row.team.id === winnerTeamId ? 1 : 0),
        previousRank: row.rank,
      }))
      .sort(
        (a, b) =>
          b.points - a.points ||
          a.previousRank - b.previousRank ||
          a.teamId.localeCompare(b.teamId),
      )

    return simulated.reduce(
      (sum, row, index) => sum + Math.abs((currentRanks.get(row.teamId) ?? index + 1) - (index + 1)),
      0,
    )
  }

  return Math.max(
    impactWhen(match.home_team_id),
    impactWhen(match.away_team_id),
  )
}

function compareScores(a: CandidateScore, b: CandidateScore) {
  return (
    a.projectedSpread - b.projectedSpread ||
    a.backToBackTeams - b.backToBackTeams ||
    b.minimumRest - a.minimumRest ||
    a.restDifference - b.restDifference ||
    b.totalRest - a.totalRest ||
    a.standingImpact - b.standingImpact ||
    a.match.round_number - b.match.round_number ||
    a.match.id.localeCompare(b.match.id)
  )
}

export function recommendNextMatch(
  matches: MatchWithTeams[],
  standings: StandingRow[],
): MatchWithTeams | null {
  const completed = matches
    .filter((match) => match.status !== 'scheduled')
    .sort((a, b) =>
      (a.result_recorded_at ?? '').localeCompare(b.result_recorded_at ?? '') ||
      a.id.localeCompare(b.id),
    )
  const candidates = matches.filter(
    (match) =>
      match.status === 'scheduled' &&
      match.live_status === 'available' &&
      areAllMatchPlayersPresent(match),
  )
  if (candidates.length === 0) return null

  const teamIds = new Set<string>()
  const played = new Map<string, number>()
  const lastPlayedIndex = new Map<string, number>()

  for (const match of matches) {
    teamIds.add(match.home_team_id)
    teamIds.add(match.away_team_id)
  }
  completed.forEach((match, index) => {
    played.set(match.home_team_id, (played.get(match.home_team_id) ?? 0) + 1)
    played.set(match.away_team_id, (played.get(match.away_team_id) ?? 0) + 1)
    lastPlayedIndex.set(match.home_team_id, index)
    lastPlayedIndex.set(match.away_team_id, index)
  })

  const playing = matches.filter(
    (match) => match.status === 'scheduled' && match.live_status === 'playing',
  )
  const playingTeamIds = new Set(
    playing.flatMap((match) => [match.home_team_id, match.away_team_id]),
  )
  const alternativesWithoutPlayingTeams = playing.length > 0
    ? candidates.filter(
        (match) =>
          !playingTeamIds.has(match.home_team_id) &&
          !playingTeamIds.has(match.away_team_id),
      )
    : candidates
  const eligible = playing.length > 0 ? alternativesWithoutPlayingTeams : candidates
  if (eligible.length === 0) return null

  const restFor = (teamId: string) => {
    const lastIndex = lastPlayedIndex.get(teamId)
    return lastIndex == null ? completed.length + 1 : completed.length - 1 - lastIndex
  }

  const scored = eligible.map((match): CandidateScore => {
    const projectedCounts = [...teamIds].map((teamId) =>
      (played.get(teamId) ?? 0) +
      (teamId === match.home_team_id || teamId === match.away_team_id ? 1 : 0),
    )
    const homeRest = restFor(match.home_team_id)
    const awayRest = restFor(match.away_team_id)

    return {
      match,
      projectedSpread: Math.max(...projectedCounts) - Math.min(...projectedCounts),
      backToBackTeams: Number(homeRest === 0) + Number(awayRest === 0),
      minimumRest: Math.min(homeRest, awayRest),
      restDifference: Math.abs(homeRest - awayRest),
      totalRest: homeRest + awayRest,
      standingImpact: standingsImpact(match, standings),
    }
  })

  return scored.sort(compareScores)[0]?.match ?? null
}

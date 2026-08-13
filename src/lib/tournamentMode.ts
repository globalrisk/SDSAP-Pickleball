import type { MatchLiveStatus, MatchStatus } from '../types'

type TournamentMatch = {
  id: string
  round_number: number
  status: MatchStatus
  live_status: MatchLiveStatus
  live_court_number: number | null
  result_recorded_at: string | null
  home_team_id: string
  away_team_id: string
  home_team?: { id?: string; players?: { is_present?: boolean }[] }
  away_team?: { id?: string; players?: { is_present?: boolean }[] }
}

export interface TournamentView<T extends TournamentMatch> {
  matches: T[]
  completedCount: number
  totalCount: number
  progressPercent: number
  roundCount: number
  playing: T[]
  upNext: T | null
  available: T[]
  waiting: T[]
  recentResult: T | null
  isComplete: boolean
}

function byRoundThenId<T extends TournamentMatch>(a: T, b: T) {
  return a.round_number - b.round_number || a.id.localeCompare(b.id)
}

export function areAllMatchPlayersPresent(match: TournamentMatch) {
  const players = [
    ...(match.home_team?.players ?? []),
    ...(match.away_team?.players ?? []),
  ]
  if (players.length === 0) return true
  return players.length === 4 && players.every((player) => player.is_present === true)
}

export function buildTournamentView<T extends TournamentMatch>(matches: T[]): TournamentView<T> {
  const sorted = [...matches].sort(byRoundThenId)
  const completed = sorted.filter((match) => match.status !== 'scheduled')
  const scheduled = sorted.filter((match) => match.status === 'scheduled')
  const playing = scheduled
    .filter((match) => match.live_status === 'playing')
    .sort((a, b) => (a.live_court_number ?? 0) - (b.live_court_number ?? 0))
  const playingTeamIds = new Set(
    playing.flatMap((match) => [match.home_team_id, match.away_team_id]),
  )
  const rounds = [...new Set(sorted.map((match) => match.round_number))].sort((a, b) => a - b)
  const recentResult = [...completed].sort((a, b) => {
    const aTime = a.result_recorded_at ? Date.parse(a.result_recorded_at) : 0
    const bTime = b.result_recorded_at ? Date.parse(b.result_recorded_at) : 0
    return bTime - aTime || b.id.localeCompare(a.id)
  })[0] ?? null

  return {
    matches: sorted,
    completedCount: completed.length,
    totalCount: sorted.length,
    progressPercent: sorted.length === 0 ? 0 : Math.round((completed.length / sorted.length) * 100),
    roundCount: rounds.length,
    playing,
    upNext:
      scheduled.find(
        (match) => match.live_status === 'up_next' && areAllMatchPlayersPresent(match),
      ) ?? null,
    available: scheduled.filter(
      (match) =>
        match.live_status === 'available' &&
        areAllMatchPlayersPresent(match) &&
        !playingTeamIds.has(match.home_team_id) &&
        !playingTeamIds.has(match.away_team_id),
    ),
    waiting: scheduled.filter(
      (match) => match.live_status !== 'playing' && !areAllMatchPlayersPresent(match),
    ),
    recentResult,
    isComplete: sorted.length > 0 && completed.length === sorted.length,
  }
}

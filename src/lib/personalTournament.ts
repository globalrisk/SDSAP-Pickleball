import { resolveMatchLineups } from './playerMatches'
import { buildTournamentView } from './tournamentMode'
import type { MatchWithTeams, RatingHistoryPoint } from '../types'

export function buildPersonalTournament(playerId: string, seasonId: string, matches: MatchWithTeams[], history: RatingHistoryPoint[]) {
  const seasonMatches = matches.filter((match) => match.season_id === seasonId)
  const isMine = (match: MatchWithTeams) => {
    const { homeIds, awayIds } = resolveMatchLineups(match)
    return homeIds.includes(playerId) || awayIds.includes(playerId)
  }
  const mine = seasonMatches.filter(isMine)
  const rated = mine.filter((match) => match.status === 'completed' && match.winner_team_id)
  const won = (match: MatchWithTeams) => {
    const { homeIds } = resolveMatchLineups(match)
    return match.winner_team_id === (homeIds.includes(playerId) ? match.home_team_id : match.away_team_id)
  }
  const wins = rated.filter(won).length
  const remaining = mine.filter((match) => match.status === 'scheduled')
  const tournament = buildTournamentView(seasonMatches)
  const playing = tournament.playing.find(isMine)
  const upNext = tournament.upNext && isMine(tournament.upNext) ? tournament.upNext : null
  const results = mine.filter((match) => match.status !== 'scheduled').sort((a, b) =>
    (b.result_recorded_at ?? '').localeCompare(a.result_recorded_at ?? '')
    || b.round_number - a.round_number || a.id.localeCompare(b.id))

  const ratedIds = new Set(rated.map((match) => match.id))
  const orderedHistory = [...history].sort((a, b) => a.sequence - b.sequence)
  const points = orderedHistory.filter((point) => point.matchId && ratedIds.has(point.matchId))
  const first = points[0]
  const last = points.at(-1)
  const baseline = first ? orderedHistory.findLast((point) => point.sequence < first.sequence) : undefined
  const completeHistory = new Set(points.map((point) => point.matchId)).size === ratedIds.size
  const ratingDelta = rated.length === 0 ? 0
    : baseline && last && completeHistory ? last.rating - baseline.rating : null

  return {
    wins, losses: rated.length - wins, played: rated.length,
    forfeits: mine.filter((match) => match.status === 'forfeit').length,
    remaining: remaining.length, remainingMatches: remaining, results,
    playingMatch: playing ?? null, upNextMatch: upNext,
    hasFixtures: mine.length > 0, ratingDelta,
    endingRating: baseline && last && completeHistory ? last.rating : null,
    won,
  }
}

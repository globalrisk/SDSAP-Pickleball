import { useTranslation } from 'react-i18next'
import { useSeason } from '../context/SeasonContext'
import { useMatches } from '../hooks/useMatches'
import { useTeams } from '../hooks/useTeams'
import { getLeagueDuelProgress } from '../lib/leagueTeamDuel'
import { forecastLeagueDuelSeason } from '../lib/seasonForecast'
import { SeasonForecastSummary } from './SeasonForecastSummary'

export function LeagueTeamDuelScoreboard() {
  const { t } = useTranslation()
  const { selectedSeason } = useSeason()
  const { data: matches = [] } = useMatches()
  const { data: teams = [] } = useTeams()
  if (selectedSeason?.format !== 'team_duel' || matches.length === 0) return null
  const progress = getLeagueDuelProgress(matches)
  const champion = teams.find((team) => team.id === progress.clinchedTeamId)
  const playing = matches.filter((match) => match.status === 'scheduled' && match.live_status === 'playing')
  const forecast = teams.length === 2 ? forecastLeagueDuelSeason(matches, [teams[0]!.id, teams[1]!.id]) : null
  return <section className="mb-6 rounded-2xl border border-green-300 bg-green-50 p-4 sm:p-5" aria-label={t('leagueDuel.scoreboard')}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold text-green-950">{t('leagueDuel.title')}</h2><p className="text-sm text-green-800">{t('leagueDuel.progress', { completed: matches.length - progress.remaining, total: matches.length })}</p></div>
    <div className="mt-4 grid grid-cols-2 gap-4">{teams.map((team) => <div key={team.id} className="rounded-xl bg-white p-3 text-center"><h3 className="font-semibold" style={{ color: team.color }}>{team.name}</h3><p className="mt-1 text-3xl font-black text-green-950">{progress.wins.get(team.id) ?? 0}</p><p className="text-xs text-gray-600">{t('leagueDuel.gameWins')}</p></div>)}</div>
    <p className="mt-3 text-sm font-semibold text-green-900" role="status">{progress.complete ? progress.tied ? t('leagueDuel.jointChampions') : t('leagueDuel.champion', { name: champion?.name }) : champion ? t('leagueDuel.clinched', { name: champion.name, count: progress.remaining }) : t('leagueDuel.inProgress', { count: progress.remaining })}</p>
    <div className="mt-4 rounded-xl border border-green-200 bg-white p-3">{forecast ? <SeasonForecastSummary forecast={forecast} names={[teams[0]!.name, teams[1]!.name]} /> : <p className="text-sm text-gray-600">{t('leagueDuel.forecastUnavailable')}</p>}</div>
    {playing.length ? <ul className="mt-3 space-y-2 text-sm">{playing.map((match) => <li key={match.id} className="rounded-lg border border-green-100 bg-white p-3"><p className="font-semibold">{t('leagueDuel.onCourt', { court: match.live_court_number, game: match.duel_sequence_number })}</p><p className="mt-1">{match.home_team.players?.map((p) => p.name).join(' + ')} {t('common.vs')} {match.away_team.players?.map((p) => p.name).join(' + ')}</p></li>)}</ul> : null}
  </section>
}

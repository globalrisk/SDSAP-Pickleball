import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useLeague } from '../context/LeagueContext'
import { buildPersonalTournament } from '../lib/personalTournament'
import { resolveMatchLineups } from '../lib/playerMatches'
import { ratingChanges } from '../lib/myProfile'
import { formatMatchDate } from '../lib/formatDate'
import { roundRating } from '../lib/ratings'
import { ProfileMatchup } from './ProfileMatchup'
import type { MatchWithTeams, PlayerProfile, Season } from '../types'

export function MyProfileMatches({ profile, matches, season, names, preview = false }: {
  profile: PlayerProfile; matches: MatchWithTeams[]; season: Season | null; names: Map<string, string>; preview?: boolean
}) {
  const { t, i18n } = useTranslation()
  const { leaguePath } = useLeague()
  if (!season) return <p className="rounded-xl bg-white p-5 text-sm text-gray-600">{t('me.noSeason')}</p>
  const summary = buildPersonalTournament(profile.id, season.id, matches, profile.history)
  const changes = ratingChanges(profile.history)
  const remaining = summary.remainingMatches.filter(match => match.id !== summary.playingMatch?.id && match.id !== summary.upNextMatch?.id)
  const groups = [
    { key: 'playing', matches: summary.playingMatch ? [summary.playingMatch] : [] },
    { key: 'upNext', matches: summary.upNextMatch ? [summary.upNextMatch] : [] },
    { key: 'remaining', matches: remaining },
    { key: 'results', matches: summary.results },
  ]
  return <section className="space-y-4">
    <div><h2 className="text-lg font-bold text-green-950">{season.name}</h2><p className="mt-1 text-sm text-gray-500">{t('me.seasonMatches')}</p></div>
    {!summary.hasFixtures ? <p className="rounded-xl border border-green-200 bg-white p-5 text-sm text-gray-600">{t('me.noFixtures')}</p> : groups.map(group => group.matches.length ? <section key={group.key} className="space-y-3">
      <div className="flex items-center gap-2"><h3 className="font-bold text-green-950">{t(`me.matchGroups.${group.key}`)}</h3><span className="rounded-full border border-green-200 bg-white px-2 py-0.5 text-xs font-bold tabular-nums text-green-800">{group.matches.length}</span></div>
      {group.key === 'remaining' && !preview ? <p className="text-xs text-gray-500">{t('personal.flexibleOrder')}</p> : null}
      <ul className="grid gap-3 lg:grid-cols-2">{(preview ? group.matches.slice(0, 2) : group.matches).map(match => {
        const { homeIds, awayIds } = resolveMatchLineups(match)
        const home = homeIds.includes(profile.id)
        const partnerIds = (home ? homeIds : awayIds).filter(id => id !== profile.id)
        const lookup = (id: string) => names.get(id) ?? [...(match.home_team.players ?? []), ...(match.away_team.players ?? [])].find(player => player.pool_player_id === id)?.name ?? '?'
        const result = match.status === 'scheduled' ? null : summary.won(match) ? 'W' : 'L'
        const score = match.status !== 'forfeit' && match.home_score != null && match.away_score != null
          ? { yours: home ? match.home_score : match.away_score, opponents: home ? match.away_score : match.home_score } : null
        const change = changes.get(match.id)
        const live = group.key === 'playing' || group.key === 'upNext'
        const badge = match.status === 'forfeit' ? `${t(result === 'W' ? 'personal.win' : 'personal.loss')} · ${t('personal.forfeit')}` : result ? t(result === 'W' ? 'personal.win' : 'personal.loss') : live ? t(`me.matchGroups.${group.key}`) : t('status.scheduled')
        const badgeClass = match.status === 'forfeit' ? 'bg-amber-50 text-amber-800' : result === 'L' ? 'bg-red-50 text-red-700' : result === 'W' || live ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
        return <li key={match.id} className={`flex min-w-0 flex-col overflow-hidden rounded-xl border bg-white ${live ? 'border-green-400' : 'border-green-200'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 pt-3 sm:px-4 sm:pt-4">
            <p className="text-xs font-medium text-gray-500">{match.duel_sequence_number != null ? t('leagueDuel.gameLabel', { game: match.duel_sequence_number, round: match.round_number }) : t('personal.round', { number: match.round_number })}</p>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${badgeClass}`}>{badge}</span>
          </div>
          <div className="flex-1 px-3 pb-3 sm:px-4 sm:pb-4"><ProfileMatchup
            pair={[{ id: profile.id, name: profile.name, isYou: true }, ...partnerIds.map(id => ({ id, name: lookup(id) }))]}
            opponents={(home ? awayIds : homeIds).map(id => ({ id, name: lookup(id) }))}
            pairLabel={t('personal.yourPair')} score={score}
          /></div>
          {result || live ? <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-3 py-2.5 text-xs sm:px-4">
            <span className="text-gray-500">{result ? formatMatchDate(match.result_recorded_at, i18n.language) : group.key === 'playing' ? match.live_court_number ? t('me.court', { number: match.live_court_number }) : t('me.matchGroups.playing') : t('me.matchGroups.upNext')}</span>
            {match.status === 'forfeit' ? <span className="text-amber-800">{t('me.unrated')}</span> : match.status === 'completed' ? <span title={change == null ? t('me.ratingUnavailable') : undefined} className={`font-semibold tabular-nums ${change != null && change > 0 ? 'text-green-700' : change != null && change < 0 ? 'text-red-600' : 'text-gray-500'}`}>{change == null ? t('me.shortRatingUnavailable') : t('me.matchRating', { delta: `${roundRating(change) > 0 ? '+' : ''}${roundRating(change)}` })}</span> : null}
          </div>
          : null}
        </li>
      })}</ul>
    </section> : null)}
    {preview ? <Link to={leaguePath('/me?tab=matches')} className="inline-flex min-h-11 items-center text-sm font-semibold text-green-700 underline underline-offset-4">{t('me.allMyMatches')}</Link> : null}
  </section>
}

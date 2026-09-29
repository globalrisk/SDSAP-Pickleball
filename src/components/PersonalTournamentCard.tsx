import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useLeague } from '../context/LeagueContext'
import { useSeason } from '../context/SeasonContext'
import { useMatches } from '../hooks/useMatches'
import { usePlayerPool } from '../hooks/usePlayerPool'
import { usePlayerPreference } from '../hooks/usePlayerPreference'
import { usePlayerProfile } from '../hooks/usePlayerProfile'
import { buildPersonalTournament } from '../lib/personalTournament'
import { resolveMatchLineups } from '../lib/playerMatches'
import { roundRating } from '../lib/ratings'
import type { MatchWithTeams } from '../types'

export function PersonalTournamentCard({ seasonId: seasonIdOverride }: { seasonId?: string }) {
  const { t } = useTranslation()
  const { leaguePath } = useLeague()
  const { selectedSeason, seasons } = useSeason()
  const season = seasonIdOverride ? seasons.find((item) => item.id === seasonIdOverride) : selectedSeason
  const preference = usePlayerPreference()
  const pool = usePlayerPool()
  const matches = useMatches(seasonIdOverride)
  const player = pool.data?.find((item) => item.id === preference.playerId)
  const profile = usePlayerProfile(player?.id)
  const selectId = useId()
  const [copyResult, setCopyResult] = useState<{ text: string; status: 'copied' | 'failed' } | null>(null)
  const summary = player && season && matches.data
    ? buildPersonalTournament(player.id, season.id, matches.data, profile.data?.history ?? []) : null
  const signed = (value: number) => {
    const rounded = roundRating(value)
    return rounded > 0 ? `+${rounded}` : String(rounded)
  }
  const delta = summary?.ratingDelta
  const names = new Map(pool.data?.map((item) => [item.id, item.name]))
  const matchNames = (match: MatchWithTeams) => {
    const { homeIds, awayIds } = resolveMatchLineups(match)
    const onHome = homeIds.includes(player!.id)
    const lookup = (id: string) => names.get(id)
      ?? [...(match.home_team.players ?? []), ...(match.away_team.players ?? [])].find((item) => item.pool_player_id === id)?.name
      ?? t('personal.unknownPlayer')
    return {
      partner: (onHome ? homeIds : awayIds).filter((id) => id !== player!.id).map(lookup).join(', '),
      opponents: (onHome ? awayIds : homeIds).map(lookup).join(' & '),
      opponentIds: onHome ? awayIds : homeIds,
      score: match.home_score != null && match.away_score != null
        ? `${onHome ? match.home_score : match.away_score}–${onHome ? match.away_score : match.home_score}` : null,
    }
  }
  const remainingMatchups = (summary?.remainingMatches ?? [])
    .map((match) => ({ match, names: matchNames(match) }))
    .sort((a, b) => a.names.opponents.localeCompare(b.names.opponents) || a.match.id.localeCompare(b.match.id))
  const isRecap = Boolean(summary?.hasFixtures && summary.remaining === 0)
  const recapText = player && season && summary ? [
    `${player.name} · ${season.name}`,
    t('personal.recapRecord', { wins: summary.wins, losses: summary.losses }),
    delta != null ? t('personal.recapRating', { delta: signed(delta) }) : null,
    summary.endingRating != null ? t('personal.recapEnding', { rating: roundRating(summary.endingRating) }) : null,
    summary.forfeits ? t('personal.forfeits', { count: summary.forfeits }) : null,
    `${window.location.origin}${leaguePath(`/seasons/${season.id}/recap`)}`,
  ].filter(Boolean).join('\n') : ''
  const copyStatus = copyResult?.text === recapText ? copyResult.status : 'idle'

  async function copyRecap() {
    try {
      await navigator.clipboard.writeText(recapText)
      setCopyResult({ text: recapText, status: 'copied' })
    } catch {
      setCopyResult({ text: recapText, status: 'failed' })
    }
  }

  function changePlayer(id: string | null) {
    preference.selectPlayer(id)
    setCopyResult(null)
  }

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-green-300 bg-white shadow-sm" aria-labelledby={`${selectId}-title`}>
      <div className="border-b border-green-100 bg-green-50/70 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-green-700">{season?.name ?? t('personal.eyebrow')}</p>
            <h2 id={`${selectId}-title`} className="mt-1 text-lg font-black text-green-950">{t(isRecap ? 'personal.recapTitle' : 'personal.title')}</h2>
            {!player ? <p className="mt-1 text-sm text-gray-600">{t('personal.intro')}</p> : null}
          </div>
          {player ? <Link to={leaguePath(`/players/${player.id}`)} className="inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-semibold text-green-800 hover:bg-green-100">{t('personal.viewProfile')}</Link> : null}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <label htmlFor={selectId} className="mb-1 block text-xs font-semibold text-green-900">{t('personal.selectName')}</label>
            <select id={selectId} value={player?.id ?? ''} disabled={pool.isLoading || pool.isError}
              onChange={(event) => changePlayer(event.target.value || null)}
              className="min-h-11 w-full rounded-xl border border-green-300 bg-white px-3 py-2 text-sm font-bold text-green-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
              <option value="">{t('personal.chooseName')}</option>
              {[...(pool.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          {preference.playerId ? <button type="button" onClick={() => changePlayer(null)} className="min-h-11 rounded-xl border border-green-200 px-3 text-sm font-semibold text-green-800 hover:bg-green-100">{t('personal.clear')}</button> : null}
        </div>
        <label className="mt-3 inline-flex min-h-8 cursor-pointer items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={preference.remember} onChange={(event) => preference.setRemember(event.target.checked)} className="h-4 w-4 accent-green-700" />
          {t('personal.remember')}
        </label>
        {preference.playerId && preference.remember && !preference.storageAvailable ? <p className="mt-1 text-xs text-amber-800" role="status">{t('personal.storageUnavailable')}</p> : null}
        {preference.playerId && pool.isSuccess && !player ? <p className="mt-2 text-sm text-gray-600">{t('personal.playerUnavailable')}</p> : null}
        {pool.isError ? <RetryMessage message={t('personal.playersError')} onRetry={() => void pool.refetch()} /> : null}
      </div>

      {player ? (
        <div className="p-4 sm:p-5">
          {!season ? <p className="text-sm text-gray-600">{t('personal.noSeason')}</p> : matches.isLoading ? <p className="text-sm text-gray-600">{t('common.loading')}</p>
            : matches.isError ? <RetryMessage message={t('personal.matchesError')} onRetry={() => void matches.refetch()} />
            : summary && !summary.hasFixtures ? <p className="text-sm text-gray-600">{t('personal.noFixtures')}</p>
            : summary ? <>
              <dl className="grid grid-cols-3 gap-2">
                <PersonalStat label={t('personal.record')} value={`${summary.wins}–${summary.losses}`} />
                <PersonalStat label={t('personal.ratingChange')} value={delta == null ? '—' : signed(delta)} />
                <PersonalStat label={t('personal.remaining')} value={String(summary.remaining)} />
              </dl>
              {summary.forfeits > 0 ? <p className="mt-2 text-xs text-gray-500">{t('personal.forfeits', { count: summary.forfeits })}</p> : null}
              {profile.isError ? <RetryMessage message={t('personal.ratingError')} onRetry={() => void profile.refetch()} /> : delta == null ? <p className="mt-2 text-xs text-gray-500">{t(profile.isLoading ? 'common.loading' : 'personal.ratingPending')}</p> : null}

              {remainingMatchups.length > 0 ? (
                <div className="mt-4">
                  <h3 className="text-sm font-bold text-green-950">{t('personal.remainingMatchups', { count: remainingMatchups.length })}</h3>
                  <p className="mt-1 text-xs text-gray-600">{t('personal.flexibleOrder')}</p>
                  <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                    {remainingMatchups.map(({ match, names: matchupNames }) => {
                      const queueStatus = match.id === summary.playingMatch?.id ? 'playing'
                        : match.id === summary.upNextMatch?.id ? 'upNext' : null
                      return <li key={match.id} className={`rounded-xl border p-3 ${queueStatus ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
                        {queueStatus ? <p className="mb-1 text-xs font-bold uppercase tracking-wide text-green-700">{t(`personal.${queueStatus}`)}{queueStatus === 'playing' && match.live_court_number ? ` · ${t('live.court', { number: match.live_court_number })}` : ''}</p> : null}
                        <p className="font-bold text-green-950">{t('personal.against', { names: matchupNames.opponents })}</p>
                        {matchupNames.partner ? <p className="mt-1 text-sm text-green-800">{t('personal.partner', { name: matchupNames.partner })}</p> : null}
                        <p className="mt-1 text-xs text-gray-500">{t('personal.round', { number: match.round_number })}</p>
                        {season.status === 'active' && profile.data ? matchupNames.opponentIds.map((opponentId) => {
                          const rivalry = profile.data.rivalries.byOpponent.find((item) => item.opponentId === opponentId)
                          return rivalry ? <p key={opponentId} className="mt-2 text-xs text-green-900">{t('personal.rivalry', { name: rivalry.opponentName, wins: rivalry.wins, losses: rivalry.losses })}</p> : null
                        }) : null}
                      </li>
                    })}
                  </ul>
                </div>
              ) : <p className="mt-4 text-sm font-semibold text-green-800">{t('personal.allDone')}</p>}

              {summary.results.length > 0 ? <details className="mt-4">
                <summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold text-green-900">{t('personal.results', { count: summary.results.length })}</summary>
                <ul className="mt-1 divide-y divide-green-100">
                  {summary.results.map((match) => {
                    const details = matchNames(match)
                    return <li key={match.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                      <div><p className="font-semibold text-gray-800">{t('personal.against', { names: details.opponents })}</p><p className="mt-0.5 text-xs text-gray-500">{t('personal.round', { number: match.round_number })}{details.partner ? ` · ${t('personal.partner', { name: details.partner })}` : ''}</p></div>
                      <span className="shrink-0 font-bold text-green-900">{t(match.status === 'forfeit' ? 'personal.forfeit' : summary.won(match) ? 'personal.win' : 'personal.loss')}{match.status !== 'forfeit' && details.score ? ` ${details.score}` : ''}</span>
                    </li>
                  })}
                </ul>
              </details> : null}

              {isRecap ? <div className="mt-4 border-t border-green-100 pt-4">
                <p className="text-sm text-gray-700">{t('personal.recapRecord', { wins: summary.wins, losses: summary.losses })}{summary.endingRating != null ? ` · ${t('personal.recapEnding', { rating: roundRating(summary.endingRating) })}` : ''}</p>
                <button type="button" disabled={summary.played > 0 && delta == null} onClick={() => void copyRecap()} className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-green-700 px-4 text-sm font-bold text-white hover:bg-green-800 disabled:opacity-50">{t('personal.copyRecap')}</button>
                <p role="status" className="mt-2 text-xs text-green-800">{copyStatus !== 'idle' ? t(`personal.${copyStatus}`) : ''}</p>
                {copyStatus === 'failed' ? <textarea readOnly value={recapText} aria-label={t('personal.copyRecap')} className="mt-2 h-40 w-full rounded-xl border border-green-200 p-3 text-sm" /> : null}
              </div> : null}
            </> : null}
        </div>
      ) : null}
    </section>
  )
}

function PersonalStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-green-50 px-2 py-3 text-center"><dt className="text-xs text-green-800">{label}</dt><dd className="mt-1 text-xl font-black text-green-950">{value}</dd></div>
}

function RetryMessage({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return <div className="mt-2 text-sm text-amber-900" role="status"><p>{message}</p><button type="button" onClick={onRetry} className="min-h-10 font-semibold underline">{t('personal.retry')}</button></div>
}

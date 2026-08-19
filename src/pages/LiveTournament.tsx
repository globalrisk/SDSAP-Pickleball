import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArchivedSeasonBanner } from '../components/ArchivedSeasonBanner'
import { LiveMatchCard } from '../components/LiveMatchCard'
import { ErrorState, LoadingState, SetupBanner } from '../components/Layout'
import type { SavedMatchResult } from '../components/RecordResultForm'
import { useSeason } from '../context/SeasonContext'
import { useMatches } from '../hooks/useMatches'
import { useStandings } from '../hooks/useStandings'
import { useTeamsWithPlayers } from '../hooks/useTeams'
import {
  useTournamentRealtime,
  type TournamentConnectionStatus,
} from '../hooks/useTournamentRealtime'
import {
  seedMatchUpNext,
  setLiveCourtCount,
  setMatchLiveStatus,
  setPlayerPresence,
} from '../lib/api'
import { recommendNextMatch } from '../lib/matchRecommendation'
import { buildTournamentView } from '../lib/tournamentMode'
import type { MatchLiveStatus, MatchWithTeams } from '../types'

const actionClass =
  'inline-flex min-h-10 flex-1 items-center justify-center rounded-xl px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50 sm:flex-none'

export function LiveTournamentPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { selectedSeason, isSelectedSeasonActive, isLoading: seasonLoading } = useSeason()
  const matchesQuery = useMatches()
  const standingsQuery = useStandings()
  const teamsQuery = useTeamsWithPlayers()
  const [lastWinnerTeamId, setLastWinnerTeamId] = useState<string | null>(null)

  const connection = useTournamentRealtime(selectedSeason?.id)

  const tournament = useMemo(
    () => buildTournamentView(matchesQuery.data ?? []),
    [matchesQuery.data],
  )
  const lastWinner = standingsQuery.standings.find(
    (standing) => standing.team.id === lastWinnerTeamId,
  )
  const remainingCount = tournament.totalCount - tournament.completedCount
  const courtCount = selectedSeason?.live_court_count ?? 1
  const recommendedMatch = useMemo(
    () => recommendNextMatch(matchesQuery.data ?? [], standingsQuery.standings),
    [matchesQuery.data, standingsQuery.standings],
  )

  const queueMutation = useMutation({
    mutationFn: ({ matchId, liveStatus }: { matchId: string; liveStatus: MatchLiveStatus }) =>
      setMatchLiveStatus(matchId, liveStatus),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['matches', selectedSeason?.id] }),
  })

  const presenceMutation = useMutation({
    mutationFn: ({ playerId, isPresent }: { playerId: string; isPresent: boolean }) =>
      setPlayerPresence(playerId, isPresent),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['teams-with-players', selectedSeason?.id] }),
        queryClient.invalidateQueries({ queryKey: ['matches', selectedSeason?.id] }),
      ]),
  })

  const seedMutation = useMutation({
    mutationFn: seedMatchUpNext,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['matches', selectedSeason?.id] }),
  })

  const courtCountMutation = useMutation({
    mutationFn: (count: number) => setLiveCourtCount(selectedSeason!.id, count),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seasons'] }),
  })

  const seedUpNext = seedMutation.mutate
  useEffect(() => {
    if (
      !isSelectedSeasonActive ||
      tournament.upNext ||
      !recommendedMatch ||
      seedMutation.isPending
    ) {
      return
    }
    seedUpNext(recommendedMatch.id)
  }, [
    isSelectedSeasonActive,
    recommendedMatch,
    seedMutation.isPending,
    seedUpNext,
    tournament.upNext,
  ])

  if (seasonLoading || matchesQuery.isLoading || standingsQuery.isLoading || teamsQuery.isLoading) {
    return <LoadingState />
  }

  const error = matchesQuery.error ?? standingsQuery.error ?? teamsQuery.error
  if (error) return <ErrorState message={(error as Error).message} />
  const actionError =
    queueMutation.error ?? presenceMutation.error ?? seedMutation.error ?? courtCountMutation.error

  function moveMatch(match: MatchWithTeams, liveStatus: MatchLiveStatus) {
    queueMutation.reset()
    queueMutation.mutate({ matchId: match.id, liveStatus })
  }

  function cancelPlayingMatch(match: MatchWithTeams) {
    if (
      !confirm(
        t('live.confirmCancelMatch', {
          home: match.home_team.name,
          away: match.away_team.name,
        }),
      )
    ) {
      return
    }
    moveMatch(match, 'available')
  }

  function handleSaved(result: SavedMatchResult) {
    setLastWinnerTeamId(result.winnerTeamId)
  }

  function queueActions(match: MatchWithTeams) {
    return (
      <>
        <button
          type="button"
          disabled={queueMutation.isPending || tournament.playing.length >= courtCount}
          onClick={() => moveMatch(match, 'playing')}
          className={`${actionClass} bg-green-600 text-white hover:bg-green-700`}
        >
          {t('live.playNow')}
        </button>
        <button
          type="button"
          disabled={queueMutation.isPending}
          onClick={() => moveMatch(match, 'up_next')}
          className={`${actionClass} bg-amber-100 text-amber-900 hover:bg-amber-200`}
        >
          {t('live.setUpNext')}
        </button>
      </>
    )
  }

  function upNextActions(match: MatchWithTeams) {
    return (
      <>
        <button type="button" disabled={queueMutation.isPending || tournament.playing.length >= courtCount} onClick={() => moveMatch(match, 'playing')} className={`${actionClass} bg-green-600 text-white hover:bg-green-700`}>
          {t('live.playNow')}
        </button>
      </>
    )
  }

  return (
    <div>
      <SetupBanner />
      <ArchivedSeasonBanner />

      {connection.status !== 'connected' ? (
        <div
          className={`mb-5 rounded-2xl border px-4 py-3 text-sm ${
            connection.status === 'offline'
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
          role="status"
          aria-live="polite"
        >
          <p className="font-bold">{t(`live.connection.${connection.status}`)}</p>
          <p className="mt-0.5">
            {t(
              connection.status === 'offline'
                ? 'live.connection.offlineMessage'
                : 'live.connection.reconnectingMessage',
            )}
          </p>
        </div>
      ) : null}

      <section className="relative mb-5 overflow-hidden rounded-3xl bg-gradient-to-br from-green-950 via-green-800 to-emerald-600 px-5 py-6 text-white shadow-lg sm:px-7 sm:py-8">
        <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full bg-lime-300/20 blur-2xl" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-red-500 px-3 py-1 text-xs font-black tracking-wider shadow-sm">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              {t('live.badge')}
            </span>
            {selectedSeason ? <span className="text-sm font-medium text-green-100">{selectedSeason.name}</span> : null}
            <ConnectionBadge
              status={connection.status}
              lastSyncedAt={connection.lastSyncedAt}
            />
          </div>
          <h1 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">{t('live.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-green-100 sm:text-base">{t('live.flexibleCourtSubtitle')}</p>

          <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-green-50">
                <span>{t('live.progress')}</span>
                <span>{t('live.completedOf', { completed: tournament.completedCount, total: tournament.totalCount })}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-lime-300 transition-[width] duration-500" style={{ width: `${tournament.progressPercent}%` }} />
              </div>
            </div>
            <div className="rounded-2xl bg-white/10 px-5 py-3 text-center backdrop-blur-sm">
              <p className="text-xs uppercase tracking-wide text-green-100">{t('live.courtsConfigured')}</p>
              <p className="mt-0.5 text-lg font-black">{t('live.remaining', { count: remainingCount })}</p>
            </div>
          </div>
        </div>
      </section>

      {lastWinner ? (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-lime-300 bg-lime-50 px-4 py-3 text-lime-950 shadow-sm" role="status">
          <span className="mt-0.5 text-xl" aria-hidden="true">↗</span>
          <div>
            <p className="text-sm font-bold">{t('live.standingsUpdated')}</p>
            <p className="mt-0.5 text-sm">{t('live.teamUpdate', { team: lastWinner.team.name, rank: lastWinner.rank, wins: lastWinner.wins, points: lastWinner.points })}</p>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          <p className="font-semibold">{t('error.title')}</p>
          <p className="mt-1">{(actionError as Error).message}</p>
        </div>
      ) : null}

      {selectedSeason && isSelectedSeasonActive ? (
        <section className="mb-6 flex flex-col gap-3 rounded-2xl border border-green-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-black text-green-950">{t('live.numberOfCourts')}</h2>
            <p className="mt-0.5 text-xs text-gray-600">{t('live.courtCountHint')}</p>
          </div>
          <select
            value={courtCount}
            disabled={courtCountMutation.isPending}
            onChange={(event) => courtCountMutation.mutate(Number(event.target.value))}
            aria-label={t('live.numberOfCourts')}
            className="min-h-11 rounded-xl border border-green-300 bg-green-50 px-4 py-2 text-sm font-bold text-green-900"
          >
            {[1, 2, 3, 4].map((count) => (
              <option key={count} value={count}>{t('live.courtCount', { count })}</option>
            ))}
          </select>
        </section>
      ) : null}

      {teamsQuery.data && teamsQuery.data.length > 0 ? (
        <section className="mb-6 rounded-2xl border border-green-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4">
            <p className="text-xs font-bold uppercase tracking-wider text-green-700">{t('live.attendanceEyebrow')}</p>
            <h2 className="text-lg font-black text-green-950">{t('live.playerAttendance')}</h2>
            <p className="mt-1 text-sm text-gray-600">{t('live.attendanceHint')}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {teamsQuery.data.map((team) => (
              <div key={team.id} className="rounded-xl border border-gray-200 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: team.color }} />
                  <p className="truncate text-xs font-bold uppercase tracking-wide text-gray-600">{team.name}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {team.players.map((player) => {
                    const isPresent = player.is_present === true
                    const isThisPending =
                      presenceMutation.isPending &&
                      presenceMutation.variables?.playerId === player.id
                    return (
                      <button
                        key={player.id}
                        type="button"
                        disabled={!isSelectedSeasonActive || presenceMutation.isPending}
                        onClick={() => presenceMutation.mutate({ playerId: player.id, isPresent: !isPresent })}
                        className={`min-h-11 rounded-xl border px-2 py-2 text-left text-xs font-bold transition-colors disabled:opacity-50 ${
                          isPresent
                            ? 'border-green-300 bg-green-50 text-green-900 hover:bg-green-100'
                            : 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100'
                        }`}
                        aria-pressed={isPresent}
                      >
                        <span className="block truncate">{player.name}</span>
                        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide opacity-75">
                          {isThisPending ? t('common.loading') : isPresent ? t('live.present') : t('live.notPresent')}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tournament.totalCount === 0 ? (
        <section className="rounded-2xl border border-dashed border-green-300 bg-white p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl">🏓</div>
          <h2 className="mt-4 text-lg font-bold text-green-950">{t('live.noMatchesTitle')}</h2>
          <p className="mt-1 text-sm text-gray-600">{t('live.noMatchesBody')}</p>
          {isSelectedSeasonActive ? <Link to="/matches" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-green-600 px-5 py-2 text-sm font-bold text-white hover:bg-green-700">{t('live.createSchedule')}</Link> : null}
        </section>
      ) : tournament.isComplete ? (
        <section className="mb-5 rounded-2xl border border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50 p-5 text-center shadow-sm">
          <div className="text-4xl" aria-hidden="true">🏆</div>
          <h2 className="mt-2 text-xl font-black text-amber-950">{t('live.tournamentComplete')}</h2>
          {selectedSeason ? <Link to={`/seasons/${selectedSeason.id}/recap`} className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-amber-500 px-5 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400">{t('live.viewRecap')}</Link> : null}
        </section>
      ) : null}

      {tournament.totalCount > 0 && !tournament.isComplete ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0 space-y-7">
            <section>
              <h2 className="mb-3 text-xl font-black text-green-950">{t('live.playingNow')}</h2>
              <div className="grid gap-4 xl:grid-cols-2">
                {Array.from({ length: courtCount }, (_, index) => index + 1).map((courtNumber) => {
                  const playingMatch = tournament.playing.find(
                    (match) => match.live_court_number === courtNumber,
                  )
                  return playingMatch ? (
                    <LiveMatchCard
                      key={playingMatch.id}
                      match={playingMatch}
                      label={t('live.court', { number: courtNumber })}
                      tone="playing"
                      actions={
                        isSelectedSeasonActive ? (
                          <button
                            type="button"
                            disabled={queueMutation.isPending}
                            onClick={() => cancelPlayingMatch(playingMatch)}
                            className={`${actionClass} border border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}
                          >
                            {t('live.cancelMatch')}
                          </button>
                        ) : null
                      }
                      showResultForm={isSelectedSeasonActive}
                      onSaved={handleSaved}
                    />
                  ) : (
                    <div key={courtNumber} className="rounded-2xl border-2 border-dashed border-green-300 bg-green-50 p-6 text-center">
                      <p className="text-xs font-bold uppercase tracking-wider text-green-700">{t('live.court', { number: courtNumber })}</p>
                      <p className="mt-1 font-bold text-green-950">{t('live.courtEmpty')}</p>
                      <p className="mt-1 text-sm text-green-700">{t('live.chooseAvailable')}</p>
                    </div>
                  )
                })}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-black text-green-950">{t('live.upNext')}</h2>
              {tournament.upNext ? (
                <LiveMatchCard
                  match={tournament.upNext}
                  label={t('live.autoSelected')}
                  tone="next"
                  actions={isSelectedSeasonActive ? upNextActions(tournament.upNext) : null}
                />
              ) : (
                <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{t('live.noUpNext')}</p>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-green-700">{t('live.anyRound')}</p>
                  <h2 className="text-lg font-black text-green-950">{t('live.availableMatches')}</h2>
                </div>
                <span className="text-xs font-semibold text-gray-500">{t('live.matchCount', { count: tournament.available.length })}</span>
              </div>
              <div className="space-y-3">
                {tournament.available.map((match) => (
                  <LiveMatchCard key={match.id} match={match} label={t('live.ready')} actions={isSelectedSeasonActive ? queueActions(match) : null} />
                ))}
              </div>
            </section>

          </div>

          <aside className="self-start rounded-2xl border border-green-200 bg-white p-4 shadow-sm lg:sticky lg:top-24">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-green-700">{t('live.liveStandings')}</p>
                <h2 className="text-lg font-black text-green-950">{t('standings.title')}</h2>
              </div>
              <ConnectionBadge
                status={connection.status}
                lastSyncedAt={connection.lastSyncedAt}
              />
            </div>
            <ol className="divide-y divide-gray-100">
              {standingsQuery.standings.map((standing) => (
                <li key={standing.team.id} className="flex items-center gap-3 py-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${standing.rank <= 3 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{standing.rank}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-gray-900">{standing.team.name}</p><p className="text-xs text-gray-500">{t('standings.record', { wins: standing.wins, losses: standing.losses })}</p></div>
                  <span className="text-sm font-black text-green-800">{standing.points}</span>
                </li>
              ))}
            </ol>
            <Link to="/standings" className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-green-50 text-sm font-bold text-green-800 hover:bg-green-100">{t('common.viewAll')}</Link>
          </aside>
        </div>
      ) : null}
    </div>
  )
}

function ConnectionBadge({
  status,
  lastSyncedAt,
}: {
  status: TournamentConnectionStatus
  lastSyncedAt: Date | null
}) {
  const { t, i18n } = useTranslation()
  const styles = {
    connected: 'bg-green-50 text-green-800',
    connecting: 'bg-amber-50 text-amber-800',
    reconnecting: 'bg-amber-50 text-amber-800',
    offline: 'bg-red-50 text-red-800',
  }
  const dotStyles = {
    connected: 'bg-green-500',
    connecting: 'animate-pulse bg-amber-500',
    reconnecting: 'animate-pulse bg-amber-500',
    offline: 'bg-red-500',
  }
  const time = lastSyncedAt?.toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${styles[status]}`}
      title={time ? t('live.connection.updatedAt', { time }) : undefined}
    >
      <span className={`h-2 w-2 rounded-full ${dotStyles[status]}`} />
      {t(`live.connection.${status}`)}
      {status === 'connected' && time ? (
        <span className="hidden font-normal opacity-75 sm:inline">· {time}</span>
      ) : null}
    </span>
  )
}

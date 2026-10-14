import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatMatchDate } from '../lib/formatDate'
import type { PlayerRivalries, PlayerRivalry } from '../types'
import { useLeague } from '../context/LeagueContext'

interface ProfileRivalriesProps {
  playerName: string
  rivalries: PlayerRivalries
}

export function ProfileRivalries({ playerName, rivalries }: ProfileRivalriesProps) {
  const { t, i18n } = useTranslation()
  const { leaguePath } = useLeague()
  const { nemesis, favoriteOpponent, byOpponent } = rivalries

  if (byOpponent.length === 0) {
    return null
  }

  return (
    <section className="mb-6 rounded-xl border border-green-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-1 text-lg font-semibold text-green-900">
        {t('rivalries.title')}
      </h2>
      <p className="mb-4 text-xs text-gray-500">{t('rivalries.subtitle')}</p>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <SummaryCard
          label={t('rivalries.nemesis')}
          rivalry={nemesis}
          empty={t('rivalries.needTwoMeetings')}
          detail={
            nemesis
              ? t('rivalries.nemesisDetail', {
                  losses: nemesis.losses,
                  played: nemesis.played,
                })
              : undefined
          }
        />
        <SummaryCard
          label={t('rivalries.favorite')}
          rivalry={favoriteOpponent}
          empty={t('rivalries.needTwoMeetings')}
          detail={
            favoriteOpponent
              ? t('rivalries.favoriteDetail', {
                  wins: favoriteOpponent.wins,
                  played: favoriteOpponent.played,
                })
              : undefined
          }
        />
      </div>

      <ul className="grid items-start gap-3 lg:grid-cols-2">
        {byOpponent.map((row) => {
          const leadKey =
            row.wins === row.losses
              ? 'rivalries.h2hTied'
              : row.wins > row.losses
                ? 'rivalries.h2hLead'
                : 'rivalries.h2hTrail'
          const lead =
            row.wins === row.losses
              ? t(leadKey, {
                  player: playerName,
                  opponent: row.opponentName,
                  wins: row.wins,
                  losses: row.losses,
                })
              : row.wins > row.losses
                ? t(leadKey, {
                    player: playerName,
                    opponent: row.opponentName,
                    wins: row.wins,
                    losses: row.losses,
                  })
                : t(leadKey, {
                    player: playerName,
                    opponent: row.opponentName,
                    wins: row.losses,
                    losses: row.wins,
                  })

          const dateLabel = formatMatchDate(row.latestMeeting.date, i18n.language)

          return (
            <li
              key={row.opponentId}
              className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white"
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 p-3 sm:p-4">
                <div className="min-w-0">
                  <Link
                    to={leaguePath(`/players/${row.opponentId}`)}
                    className="rounded text-sm font-bold leading-5 text-green-950 underline-offset-2 [overflow-wrap:anywhere] hover:text-green-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
                  >
                    {row.opponentName}
                  </Link>
                  <p className="mt-1 text-xs text-gray-500">{t('rivalries.meetings', { count: row.played })} · {Math.round(row.winRate * 100)}% {t('profile.winRate').toLocaleLowerCase(i18n.language)}</p>
                  <p className="sr-only">{lead}</p>
                </div>
                <div className="text-right"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('profile.record')}</p><p className="whitespace-nowrap text-xl font-black tabular-nums"><span className="text-green-700">{row.wins}</span><span className="mx-1 text-gray-300">–</span><span className="text-gray-600">{row.losses}</span></p></div>
              </div>
              <div className="mx-3 flex h-1 overflow-hidden rounded-full bg-gray-100 sm:mx-4" aria-hidden="true"><span className="bg-green-500" style={{ width: `${row.winRate * 100}%` }} /></div>
              <details className="group px-3 sm:px-4">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded text-xs text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 [&::-webkit-details-marker]:hidden">
                  <span className="font-semibold text-green-800">{t('rivalries.latestMeeting')}<span className="sr-only"> · {row.opponentName}</span></span>
                  <span className="flex items-center gap-2">{dateLabel}<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180"><path d="m4 6 4 4 4-4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                </summary>
                <div className="mb-3 space-y-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className={`rounded-full px-2 py-1 font-bold ${row.latestMeeting.result === 'W' ? 'bg-green-100 text-green-800' : 'bg-red-50 text-red-700'}`}>{t(row.latestMeeting.result === 'W' ? 'rivalries.latestWin' : 'rivalries.latestLoss')}{row.latestMeeting.scoreLabel ? ` · ${row.latestMeeting.scoreLabel}` : ''}</span>{row.latestMeeting.seasonName ? <span>{row.latestMeeting.seasonName}</span> : null}</div>
                  {row.latestMeeting.partnerName ? <p className="break-words">{t('profile.withPartner', { name: row.latestMeeting.partnerName })}</p> : null}
                  <p>{t('rivalries.streak', { count: row.longestWinStreak })}</p>
                </div>
              </details>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function SummaryCard({
  label,
  rivalry,
  empty,
  detail,
}: {
  label: string
  rivalry: PlayerRivalry | null
  empty: string
  detail?: string
}) {
  const { leaguePath } = useLeague()
  return (
    <div className="rounded-lg bg-green-50 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      {rivalry ? (
        <>
          <Link
            to={leaguePath(`/players/${rivalry.opponentId}`)}
            className="mt-1 block text-lg font-bold text-green-900 underline-offset-2 [overflow-wrap:anywhere] hover:underline focus-visible:ring-2 focus-visible:ring-green-600"
          >
            {rivalry.opponentName}
          </Link>
          {detail ? <p className="mt-0.5 text-xs text-gray-600">{detail}</p> : null}
        </>
      ) : (
        <p className="mt-1 text-sm text-gray-600">{empty}</p>
      )}
    </div>
  )
}

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatMatchDate } from '../lib/formatDate'
import type { PlayerRivalries, PlayerRivalry } from '../types'

interface ProfileRivalriesProps {
  playerName: string
  rivalries: PlayerRivalries
}

export function ProfileRivalries({ playerName, rivalries }: ProfileRivalriesProps) {
  const { t, i18n } = useTranslation()
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

      <ul className="space-y-3">
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

          const latestBits: string[] = []
          if (row.latestMeeting.result === 'W') {
            latestBits.push(t('rivalries.latestWin'))
          } else {
            latestBits.push(t('rivalries.latestLoss'))
          }
          if (row.latestMeeting.scoreLabel) latestBits.push(row.latestMeeting.scoreLabel)
          if (row.latestMeeting.partnerName) {
            latestBits.push(
              t('profile.withPartner', { name: row.latestMeeting.partnerName }),
            )
          }
          if (row.latestMeeting.seasonName) latestBits.push(row.latestMeeting.seasonName)
          const dateLabel = formatMatchDate(row.latestMeeting.date, i18n.language)
          if (dateLabel) latestBits.push(dateLabel)

          return (
            <li
              key={row.opponentId}
              className="rounded-lg border border-green-100 bg-green-50/60 px-3 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    to={`/players/${row.opponentId}`}
                    className="font-semibold text-green-900 underline-offset-2 hover:underline"
                  >
                    {row.opponentName}
                  </Link>
                  <p className="mt-0.5 text-sm text-gray-800">{lead}</p>
                </div>
                <p className="text-xs font-medium text-gray-600">
                  {t('rivalries.streak', { count: row.longestWinStreak })}
                </p>
              </div>
              <p className="mt-1 text-xs text-gray-600">
                {t('rivalries.latest', { detail: latestBits.join(' · ') })}
              </p>
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
  return (
    <div className="rounded-lg bg-green-50 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      {rivalry ? (
        <>
          <Link
            to={`/players/${rivalry.opponentId}`}
            className="mt-1 block text-lg font-bold text-green-900 underline-offset-2 hover:underline"
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

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { LeagueHighlights } from '../lib/engagement'
import { formatMatchDate } from '../lib/formatDate'

interface DashboardHighlightsProps {
  highlights: LeagueHighlights
}

export function DashboardHighlights({ highlights }: DashboardHighlightsProps) {
  const { t, i18n } = useTranslation()
  const { hotStreak, closestMatch, recentUpset } = highlights

  if (!hotStreak && !closestMatch && !recentUpset) {
    return null
  }

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-green-900">
        {t('dashboard.highlightsTitle')}
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {hotStreak && (
          <HighlightCard
            eyebrow={t('dashboard.hotStreakLabel')}
            title={
              <Link
                to={`/players/${hotStreak.playerId}`}
                className="text-green-800 underline-offset-2 hover:underline"
              >
                {hotStreak.playerName}
              </Link>
            }
            detail={t('dashboard.hotStreakDetail', { count: hotStreak.count })}
          />
        )}
        {closestMatch && (
          <HighlightCard
            eyebrow={t('dashboard.mustWatchLabel')}
            title={`${closestMatch.match.home_team.name} vs ${closestMatch.match.away_team.name}`}
            detail={t('dashboard.mustWatchDetail', {
              home: closestMatch.match.home_team.name,
              percent: closestMatch.homePercent,
            })}
            to="/matches"
          />
        )}
        {recentUpset && (
          <HighlightCard
            eyebrow={t('dashboard.upsetLabel')}
            title={t('dashboard.upsetTitle', {
              winner: recentUpset.winnerName,
              loser: recentUpset.loserName,
            })}
            detail={t('dashboard.upsetDetail', {
              percent: recentUpset.winnerPercent,
              score: recentUpset.scoreLabel ?? '—',
              date: (() => {
                const label = formatMatchDate(
                  recentUpset.match.result_recorded_at,
                  i18n.language,
                )
                return label ? ` · ${label}` : ''
              })(),
            })}
            to="/matches"
          />
        )}
      </div>
    </section>
  )
}

function HighlightCard({
  eyebrow,
  title,
  detail,
  to,
}: {
  eyebrow: string
  title: ReactNode
  detail: string
  to?: string
}) {
  const body = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-green-700">
        {eyebrow}
      </p>
      <p className="mt-1 text-base font-bold text-gray-900">{title}</p>
      <p className="mt-1 text-sm text-gray-600">{detail}</p>
    </>
  )

  if (to) {
    return (
      <Link
        to={to}
        className="block rounded-xl border border-green-200 bg-gradient-to-br from-green-50 to-white p-4 shadow-sm transition-colors hover:border-green-300"
      >
        {body}
      </Link>
    )
  }

  return (
    <div className="rounded-xl border border-green-200 bg-gradient-to-br from-green-50 to-white p-4 shadow-sm">
      {body}
    </div>
  )
}

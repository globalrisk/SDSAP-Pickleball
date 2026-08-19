import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ErrorState, PageHeader, SetupBanner } from '../components/Layout'
import { PlayerTitleBadge } from '../components/PlayerTitleBadge'
import { ProfileFunStats } from '../components/ProfileFunStats'
import { ProfileRivalries } from '../components/ProfileRivalries'
import { RatingHistoryChart } from '../components/RatingHistoryChart'
import { usePlayerProfile } from '../hooks/usePlayerProfile'
import { formatMatchDate } from '../lib/formatDate'
import { roundRating } from '../lib/ratings'

function formatDelta(delta: number): string {
  const rounded = roundRating(delta)
  if (rounded > 0) return `+${rounded}`
  return String(rounded)
}

export function PlayerProfilePage() {
  const { t, i18n } = useTranslation()
  const { playerId } = useParams<{ playerId: string }>()
  const { data: profile, isError, error, isLoading } = usePlayerProfile(playerId)

  if (isError) return <ErrorState message={(error as Error).message} />

  if (isLoading || !profile) {
    return (
      <div>
        <SetupBanner />
        <PageHeader title={t('profile.title')} />
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      </div>
    )
  }

  const delta = roundRating(profile.ratingDelta)
  const deltaLabel = formatDelta(profile.ratingDelta)

  const matchPoints = profile.history
    .filter((point) => point.matchId)
    .slice()
    .sort((a, b) => {
      const recordedDiff = (b.resultRecordedAt ?? '').localeCompare(
        a.resultRecordedAt ?? '',
      )
      if (recordedDiff !== 0) return recordedDiff

      const seasonDiff =
        (b.seasonStartsAt ?? '').localeCompare(a.seasonStartsAt ?? '') ||
        (b.seasonName ?? '').localeCompare(a.seasonName ?? '')
      if (seasonDiff !== 0) return seasonDiff

      return a.id.localeCompare(b.id)
    })
  const deltasById = new Map<string, number>()
  for (let i = 1; i < profile.history.length; i++) {
    const prev = profile.history[i - 1]!
    const curr = profile.history[i]!
    if (curr.matchId) {
      deltasById.set(curr.id, curr.rating - prev.rating)
    }
  }

  return (
    <div>
      <SetupBanner />
      <div className="mb-4">
        <Link to="/rankings" className="text-sm text-green-700 hover:underline">
          ← {t('profile.backToRankings')}
        </Link>
      </div>
      <PageHeader
        title={profile.name}
        subtitle={
          profile.rank == null
            ? t(profile.provisional ? 'profile.provisionalSubtitle' : 'profile.unrankedSubtitle')
            : t('profile.subtitle', { rank: profile.rank })
        }
      />
      {profile.title ? (
        <div className="mb-6 -mt-2">
          <PlayerTitleBadge title={profile.title} size="md" showWhy />
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t('profile.rating')} value={String(roundRating(profile.rating))} />
        <StatCard
          label={t('profile.change')}
          value={deltaLabel}
          accent={delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral'}
        />
        <StatCard
          label={t('profile.record')}
          value={`${profile.wins}-${profile.losses}`}
        />
        <StatCard
          label={t('profile.winRate')}
          value={`${Math.round(profile.winRate * 100)}%`}
        />
      </div>

      <ProfileFunStats stats={profile.funStats} />
      <ProfileRivalries playerName={profile.name} rivalries={profile.rivalries} />

      <section className="mb-6 rounded-xl border border-green-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-green-900">{t('profile.formTitle')}</h2>
          <p className="text-xs text-gray-500">
            {t('profile.confidence', { rd: roundRating(profile.ratingDeviation) })}
          </p>
        </div>
        {profile.form.length === 0 ? (
          <p className="text-sm text-gray-500">{t('profile.noMatches')}</p>
        ) : (
          <div className="flex gap-2">
            {profile.form.map((result, index) => (
              <span
                key={`${result}-${index}`}
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white ${
                  result === 'W' ? 'bg-green-600' : 'bg-red-500'
                }`}
              >
                {result}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="mb-6 rounded-xl border border-green-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 text-lg font-semibold text-green-900">
          {t('profile.historyTitle')}
        </h2>
        <RatingHistoryChart points={profile.history} />
      </section>

      <section className="rounded-xl border border-green-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="mb-3 text-lg font-semibold text-green-900">
          {t('profile.matchesTitle')}
        </h2>
        {matchPoints.length === 0 ? (
          <p className="text-sm text-gray-500">{t('profile.noMatches')}</p>
        ) : (
          <ul className="divide-y divide-green-50">
            {matchPoints.map((point) => {
              const deltaValue = deltasById.get(point.id)
              const dateLabel = formatMatchDate(point.resultRecordedAt, i18n.language)
              return (
                <li
                  key={point.id}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {point.seasonName ? (
                        <span className="text-gray-600">{point.seasonName} · </span>
                      ) : null}
                      <span
                        className={
                          point.result === 'W' ? 'text-green-700' : 'text-red-600'
                        }
                      >
                        {point.result}
                      </span>
                      {point.scoreLabel ? ` · ${point.scoreLabel}` : ''}
                      {dateLabel ? ` · ${dateLabel}` : ''}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {point.partnerName
                        ? t('profile.withPartner', { name: point.partnerName })
                        : null}
                      {point.opponentNames.length > 0
                        ? ` · ${t('profile.vsOpponents', { names: point.opponentNames.join(', ') })}`
                        : null}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-green-800">
                      {roundRating(point.rating)}
                    </p>
                    {deltaValue != null && (
                      <p
                        className={`text-xs font-semibold ${
                          deltaValue > 0
                            ? 'text-green-700'
                            : deltaValue < 0
                              ? 'text-red-600'
                              : 'text-gray-500'
                        }`}
                      >
                        {formatDelta(deltaValue)}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function StatCard({
  label,
  value,
  accent = 'neutral',
}: {
  label: string
  value: string
  accent?: 'up' | 'down' | 'neutral'
}) {
  const valueClass =
    accent === 'up'
      ? 'text-green-700'
      : accent === 'down'
        ? 'text-red-600'
        : 'text-green-900'

  return (
    <div className="rounded-xl border border-green-200 bg-white px-3 py-3 shadow-sm sm:px-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className={`mt-1 text-xl font-bold sm:text-2xl ${valueClass}`}>{value}</p>
    </div>
  )
}

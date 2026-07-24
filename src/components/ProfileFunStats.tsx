import { useTranslation } from 'react-i18next'
import { formatSwingDelta } from '../lib/engagement'
import { formatMatchDate } from '../lib/formatDate'
import { roundRating } from '../lib/ratings'
import type { PlayerFunStats } from '../types'

interface ProfileFunStatsProps {
  stats: PlayerFunStats
}

export function ProfileFunStats({ stats }: ProfileFunStatsProps) {
  const { t, i18n } = useTranslation()
  const { currentStreak, bestPartner, biggestSwing } = stats

  if (!currentStreak && !bestPartner && !biggestSwing) {
    return null
  }

  const swingDetailParts: string[] = []
  if (biggestSwing) {
    if (biggestSwing.result) {
      swingDetailParts.push(
        biggestSwing.result === 'W'
          ? t('profile.swingResultWin')
          : t('profile.swingResultLoss'),
      )
    }
    if (biggestSwing.scoreLabel) swingDetailParts.push(biggestSwing.scoreLabel)
    if (biggestSwing.partnerName) {
      swingDetailParts.push(
        t('profile.withPartner', { name: biggestSwing.partnerName }),
      )
    }
    if (biggestSwing.opponentNames.length > 0) {
      swingDetailParts.push(
        t('profile.vsOpponents', { names: biggestSwing.opponentNames.join(', ') }),
      )
    }
    if (biggestSwing.seasonName) swingDetailParts.push(biggestSwing.seasonName)
    const dateLabel = formatMatchDate(biggestSwing.resultRecordedAt, i18n.language)
    if (dateLabel) swingDetailParts.push(dateLabel)
  }

  return (
    <section className="mb-6 rounded-xl border border-green-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 text-lg font-semibold text-green-900">
        {t('profile.funStatsTitle')}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {currentStreak && (
          <FunStat
            label={t('profile.streakLabel')}
            value={
              currentStreak.result === 'W'
                ? t('profile.streakValueWin', { count: currentStreak.count })
                : t('profile.streakValueLoss', { count: currentStreak.count })
            }
            accent={currentStreak.result === 'W' ? 'up' : 'down'}
          />
        )}
        {bestPartner && (
          <FunStat
            label={t('profile.bestPartnerLabel')}
            value={bestPartner.name}
            detail={t('profile.bestPartnerDetail', {
              wins: bestPartner.wins,
              played: bestPartner.played,
              losses: bestPartner.played - bestPartner.wins,
            })}
          />
        )}
        {biggestSwing && (
          <FunStat
            label={t('profile.biggestSwingLabel')}
            value={formatSwingDelta(biggestSwing.delta)}
            detail={
              swingDetailParts.length > 0
                ? swingDetailParts.join(' · ')
                : t('profile.biggestSwingDetail')
            }
            accent={
              roundRating(biggestSwing.delta) > 0
                ? 'up'
                : roundRating(biggestSwing.delta) < 0
                  ? 'down'
                  : 'neutral'
            }
          />
        )}
      </div>
    </section>
  )
}

function FunStat({
  label,
  value,
  detail,
  accent = 'neutral',
}: {
  label: string
  value: string
  detail?: string
  accent?: 'up' | 'down' | 'neutral'
}) {
  const valueClass =
    accent === 'up'
      ? 'text-green-700'
      : accent === 'down'
        ? 'text-red-600'
        : 'text-gray-900'

  return (
    <div className="rounded-lg bg-green-50 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className={`mt-1 text-lg font-bold ${valueClass}`}>{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-gray-600">{detail}</p> : null}
    </div>
  )
}

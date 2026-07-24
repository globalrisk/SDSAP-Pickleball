import { useTranslation } from 'react-i18next'
import { formatSwingDelta } from '../lib/engagement'
import { roundRating } from '../lib/ratings'
import type { PlayerFunStats } from '../types'

interface ProfileFunStatsProps {
  stats: PlayerFunStats
}

export function ProfileFunStats({ stats }: ProfileFunStatsProps) {
  const { t } = useTranslation()
  const { currentStreak, bestPartner, toughestOpponent, biggestSwing } = stats

  if (!currentStreak && !bestPartner && !toughestOpponent && !biggestSwing) {
    return null
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
        {toughestOpponent && (
          <FunStat
            label={t('profile.toughestOpponentLabel')}
            value={toughestOpponent.name}
            detail={t('profile.toughestOpponentDetail', {
              losses: toughestOpponent.lossesAgainst,
              played: toughestOpponent.played,
            })}
          />
        )}
        {biggestSwing && (
          <FunStat
            label={t('profile.biggestSwingLabel')}
            value={formatSwingDelta(biggestSwing.delta)}
            detail={t('profile.biggestSwingDetail')}
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

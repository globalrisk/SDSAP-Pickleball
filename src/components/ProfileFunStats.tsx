import { useTranslation } from 'react-i18next'
import { formatSwingDelta } from '../lib/engagement'
import { formatMatchDate } from '../lib/formatDate'
import { roundRating } from '../lib/ratings'
import type { PlayerFunStats } from '../types'
import { ProfileMatchup } from './ProfileMatchup'

interface ProfileFunStatsProps {
  stats: PlayerFunStats
  playerName: string
  personal?: boolean
}

export function ProfileFunStats({ stats, playerName, personal = false }: ProfileFunStatsProps) {
  const { t, i18n } = useTranslation()
  const { currentStreak, bestPartner, biggestSwing } = stats

  if (!currentStreak && !bestPartner && !biggestSwing) {
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
        {biggestSwing && (
          <div className="min-w-0 rounded-xl border border-gray-200 p-3 sm:col-span-2 sm:p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{t('profile.biggestSwingLabel')}</p><p className={`mt-1 text-2xl font-black tabular-nums ${roundRating(biggestSwing.delta) > 0 ? 'text-green-700' : roundRating(biggestSwing.delta) < 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatSwingDelta(biggestSwing.delta)}</p></div>
              {biggestSwing.result ? <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${biggestSwing.result === 'W' ? 'bg-green-100 text-green-800' : 'bg-red-50 text-red-700'}`}>{t(biggestSwing.result === 'W' ? 'profile.swingResultWin' : 'profile.swingResultLoss')}{biggestSwing.scoreLabel ? ` · ${biggestSwing.scoreLabel}` : ''}</span> : null}
            </div>
            <ProfileMatchup pair={[{ name: playerName, isYou: personal }, ...(biggestSwing.partnerName ? [{ name: biggestSwing.partnerName }] : [])]} opponents={biggestSwing.opponentNames.map(name => ({ name }))} pairLabel={personal ? t('personal.yourPair') : t('me.pair')} />
            <p className="mt-3 text-xs text-gray-500">{[biggestSwing.seasonName, formatMatchDate(biggestSwing.resultRecordedAt, i18n.language)].filter(Boolean).join(' · ')}</p>
          </div>
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
      <p className={`mt-1 text-lg font-bold [overflow-wrap:anywhere] ${valueClass}`}>{value}</p>
      {detail ? <p className="mt-0.5 text-xs text-gray-600">{detail}</p> : null}
    </div>
  )
}

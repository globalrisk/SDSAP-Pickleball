import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatMatchDate } from '../lib/formatDate'
import type { SeasonRecap, SeasonRecapTeamAward } from '../types'

interface SeasonRecapCardProps {
  recap: SeasonRecap
}

export function SeasonRecapCard({ recap }: SeasonRecapCardProps) {
  const { t, i18n } = useTranslation()

  return (
    <div className="overflow-hidden rounded-2xl border border-green-200 bg-gradient-to-br from-green-50 via-white to-amber-50 p-5 shadow-sm sm:p-6">
      <div className="mb-5 border-b border-green-100 pb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-green-700">
          {t('recap.eyebrow')}
        </p>
        <h2 className="mt-1 text-2xl font-bold text-green-950">{recap.seasonName}</h2>
        {recap.isPartial ? (
          <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">
            {t('recap.partialNotice')}
          </p>
        ) : null}
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <TeamPodium
          label={t('recap.champion')}
          teams={recap.champions}
          tone="gold"
        />
        <TeamPodium
          label={t('recap.runnerUp')}
          teams={recap.runnersUp}
          tone="silver"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {recap.mvp ? (
          <AwardTile
            eyebrow={t('recap.mvp')}
            title={
              <Link
                to={`/players/${recap.mvp.playerId}`}
                className="text-green-800 underline-offset-2 hover:underline"
              >
                {recap.mvp.playerName}
              </Link>
            }
            detail={[
              t('recap.mvpDetail', recap.mvp.detailParams),
              recap.mvp.detailParams.championBonus
                ? t('recap.mvpChampBonus')
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            note={t('recap.mvpMethod')}
          />
        ) : (
          <AwardTile eyebrow={t('recap.mvp')} title={t('recap.none')} />
        )}

        {recap.mostImproved ? (
          <AwardTile
            eyebrow={t('recap.mostImproved')}
            title={
              <Link
                to={`/players/${recap.mostImproved.playerId}`}
                className="text-green-800 underline-offset-2 hover:underline"
              >
                {recap.mostImproved.playerName}
              </Link>
            }
            detail={t('recap.mostImprovedDetail', recap.mostImproved.detailParams)}
          />
        ) : (
          <AwardTile eyebrow={t('recap.mostImproved')} title={t('recap.none')} />
        )}

        {recap.bestPartnership ? (
          <AwardTile
            eyebrow={t('recap.bestPartnership')}
            title={recap.bestPartnership.teamName}
            detail={t('recap.bestPartnershipDetail', {
              players: recap.bestPartnership.playerNames.join(' & '),
              wins: recap.bestPartnership.wins,
              losses: recap.bestPartnership.losses,
            })}
          />
        ) : (
          <AwardTile eyebrow={t('recap.bestPartnership')} title={t('recap.none')} />
        )}

        {recap.biggestUpset ? (
          <AwardTile
            eyebrow={t('recap.biggestUpset')}
            title={t('recap.upsetTitle', {
              winner: recap.biggestUpset.winnerTeamName,
              loser: recap.biggestUpset.loserTeamName,
            })}
            detail={t('recap.upsetDetail', {
              percent: recap.biggestUpset.winnerPercent,
              score: recap.biggestUpset.scoreLabel ?? '—',
              date: (() => {
                const label = formatMatchDate(
                  recap.biggestUpset.resultRecordedAt,
                  i18n.language,
                )
                return label ? ` · ${label}` : ''
              })(),
            })}
          />
        ) : (
          <AwardTile eyebrow={t('recap.biggestUpset')} title={t('recap.none')} />
        )}
      </div>

      <p className="mt-5 text-center text-[11px] text-gray-500">{t('recap.footer')}</p>
    </div>
  )
}

function TeamPodium({
  label,
  teams,
  tone,
}: {
  label: string
  teams: SeasonRecapTeamAward[]
  tone: 'gold' | 'silver'
}) {
  const { t } = useTranslation()
  const shell =
    tone === 'gold'
      ? 'border-amber-300 bg-amber-50'
      : 'border-slate-300 bg-slate-50'

  if (teams.length === 0) {
    return (
      <div className={`rounded-xl border px-4 py-3 ${shell}`}>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {label}
        </p>
        <p className="mt-1 font-semibold text-gray-700">{t('recap.none')}</p>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border px-4 py-3 ${shell}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <div className="mt-1 space-y-2">
        {teams.map((team) => (
          <div key={team.teamId}>
            <p className="text-lg font-bold text-gray-900">{team.teamName}</p>
            <p className="text-xs text-gray-600">
              {team.playerNames.join(' & ')} · {t('standings.record', {
                wins: team.wins,
                losses: team.losses,
              })}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function AwardTile({
  eyebrow,
  title,
  detail,
  note,
}: {
  eyebrow: string
  title: ReactNode
  detail?: string
  note?: string
}) {
  return (
    <div className="rounded-xl border border-green-100 bg-white/80 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-green-700">
        {eyebrow}
      </p>
      <div className="mt-1 text-base font-bold text-gray-900">{title}</div>
      {detail ? <p className="mt-1 text-xs text-gray-600">{detail}</p> : null}
      {note ? <p className="mt-2 text-[11px] italic text-gray-500">{note}</p> : null}
    </div>
  )
}

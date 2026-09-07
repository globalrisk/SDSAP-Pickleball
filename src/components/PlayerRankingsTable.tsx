import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PlayerTitleBadge } from './PlayerTitleBadge'
import { roundRating } from '../lib/ratings'
import type { PlayerRankingRow } from '../types'

interface PlayerRankingsTableProps {
  rows: PlayerRankingRow[]
}

function getPodiumStyles(rank: number | null) {
  if (rank === 1) {
    return {
      row: 'bg-yellow-50 ring-2 ring-inset ring-yellow-300',
      rankBadge: 'bg-yellow-300 text-yellow-900',
    }
  }
  if (rank === 2) {
    return {
      row: 'bg-slate-100 ring-2 ring-inset ring-slate-300',
      rankBadge: 'bg-slate-300 text-slate-800',
    }
  }
  if (rank === 3) {
    return {
      row: 'bg-amber-50 ring-2 ring-inset ring-amber-300',
      rankBadge: 'bg-amber-500 text-white',
    }
  }
  return {
    row: '',
    rankBadge: 'bg-green-100 text-green-800',
  }
}

export function PlayerRankingsTable({ rows }: PlayerRankingsTableProps) {
  const { t } = useTranslation()

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">{t('rankings.empty')}</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-green-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-green-100 bg-green-50 text-left text-xs font-semibold uppercase tracking-wide text-green-800">
            <th className="px-4 py-3">{t('rankings.rank')}</th>
            <th className="px-4 py-3">{t('rankings.player')}</th>
            <th className="px-4 py-3 text-right">{t('rankings.rating')}</th>
            <th className="px-2 py-3 text-right sm:px-4">
              {t('rankings.matchesPlayed')}
            </th>
            <th className="w-8 px-2 py-3" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isInactive = row.status === 'inactive'
            const isUnranked = isInactive || row.provisional
            const previous = rows[index - 1]
            const sectionLabel =
              isInactive && previous?.status !== 'inactive'
                ? t('rankings.inactiveSection')
                : !isInactive &&
                    row.provisional &&
                    !(previous?.status === 'active' && previous.provisional)
                  ? t('rankings.provisionalSection')
                  : null
            const podium = isUnranked
              ? { row: 'bg-gray-50/80', rankBadge: 'bg-gray-200 text-gray-500' }
              : getPodiumStyles(row.rank)
            return (
              <Fragment key={row.id}>
                {sectionLabel ? (
                  <tr className="border-y border-green-100 bg-green-50/70">
                    <td
                      colSpan={5}
                      className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-green-800"
                    >
                      {sectionLabel}
                    </td>
                  </tr>
                ) : null}
                <tr
                  className={`border-b border-green-50 last:border-0 ${podium.row} ${
                    isInactive ? 'opacity-60' : ''
                  }`}
                >
                  <td className="p-0" colSpan={5}>
                    <Link
                      to={`/players/${row.id}`}
                      className={`flex min-h-12 items-center gap-0 ${
                        isInactive ? 'active:bg-gray-100/80' : 'active:bg-green-50/80'
                      }`}
                      aria-label={t('rankings.viewProfile', { name: row.name })}
                    >
                      <span className="px-4 py-3">
                        <span
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${podium.rankBadge}`}
                        >
                          {row.rank ?? '—'}
                        </span>
                      </span>
                      <span
                        className={`min-w-0 flex-1 px-4 py-3 font-semibold ${
                          isInactive ? 'text-gray-500' : 'text-green-800'
                        }`}
                      >
                        <span className="block">{row.name}</span>
                        {isInactive ? (
                          <span className="mt-0.5 block text-xs font-normal text-gray-400">
                            {t('rankings.inactive')}
                          </span>
                        ) : row.provisional ? (
                          <span className="mt-0.5 block text-xs font-normal text-amber-700">
                            {t('rankings.provisional', { count: row.matchesPlayed })}
                          </span>
                        ) : row.title ? (
                          <span className="mt-0.5 block text-xs font-normal">
                            <PlayerTitleBadge title={row.title} />
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={`w-16 shrink-0 px-2 py-3 text-right font-bold sm:w-20 sm:px-4 ${
                          isInactive ? 'text-gray-500' : 'text-green-800'
                        }`}
                      >
                        {roundRating(row.rating)}
                      </span>
                      <span
                        className={`w-14 shrink-0 px-2 py-3 text-right sm:w-20 sm:px-4 ${
                          isInactive ? 'text-gray-400' : 'text-gray-600'
                        }`}
                        title={t('rankings.ratedMatches', { count: row.matchesPlayed })}
                      >
                        {row.matchesPlayed}
                      </span>
                      <span
                        className={`shrink-0 px-3 py-3 ${
                          isInactive ? 'text-gray-400' : 'text-green-600'
                        }`}
                        aria-hidden
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </span>
                    </Link>
                  </td>
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

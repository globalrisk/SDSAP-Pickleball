import { useTranslation } from 'react-i18next'
import { roundRating } from '../lib/ratings'
import type { PlayerRankingRow } from '../types'

interface PlayerRankingsTableProps {
  rows: PlayerRankingRow[]
}

function getPodiumStyles(rank: number) {
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
            <th className="hidden px-4 py-3 text-right sm:table-cell">{t('rankings.rd')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const podium = getPodiumStyles(row.rank)
            return (
              <tr key={row.id} className={`border-b border-green-50 last:border-0 ${podium.row}`}>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${podium.rankBadge}`}
                  >
                    {row.rank}
                  </span>
                </td>
                <td className="px-4 py-3 font-semibold text-gray-900">{row.name}</td>
                <td className="px-4 py-3 text-right font-bold text-green-800">
                  {roundRating(row.rating)}
                </td>
                <td className="hidden px-4 py-3 text-right text-gray-600 sm:table-cell">
                  {roundRating(row.ratingDeviation)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

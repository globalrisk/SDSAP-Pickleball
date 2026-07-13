import { useTranslation } from 'react-i18next'
import { roundRating } from '../lib/ratings'
import type { PlayerRankingRow } from '../types'

interface PlayerRankingsTableProps {
  rows: PlayerRankingRow[]
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
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-green-50 last:border-0">
              <td className="px-4 py-3 font-medium text-gray-500">{row.rank}</td>
              <td className="px-4 py-3 font-semibold text-gray-900">{row.name}</td>
              <td className="px-4 py-3 text-right font-bold text-green-800">
                {roundRating(row.rating)}
              </td>
              <td className="hidden px-4 py-3 text-right text-gray-600 sm:table-cell">
                {roundRating(row.ratingDeviation)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import { TeamNameWithPlayers } from './TeamNameWithPlayers'
import type { StandingRow } from '../types'

interface StandingsTableProps {
  rows: StandingRow[]
  compact?: boolean
}

function getPodiumStyles(rank: number, points: number) {
  if (points <= 0) {
    return {
      row: '',
      rankBadge: 'bg-green-100 text-green-800',
    }
  }
  if (rank === 1) {
    return {
      row: 'bg-yellow-50 ring-2 ring-yellow-300 border-yellow-200',
      rankBadge: 'bg-yellow-300 text-yellow-900',
    }
  }
  if (rank === 2) {
    return {
      row: 'bg-slate-100 ring-2 ring-slate-300 border-slate-200',
      rankBadge: 'bg-slate-300 text-slate-800',
    }
  }
  if (rank === 3) {
    return {
      row: 'bg-amber-50 ring-2 ring-amber-300 border-amber-200',
      rankBadge: 'bg-amber-500 text-white',
    }
  }
  return {
    row: '',
    rankBadge: 'bg-green-100 text-green-800',
  }
}

function StandingCard({
  row,
  compact,
}: {
  row: StandingRow
  compact: boolean
}) {
  const { t } = useTranslation()
  const podium = getPodiumStyles(row.rank, row.points)

  return (
    <div
      className={`flex items-center justify-between rounded-xl border border-green-200 bg-white px-4 py-3 shadow-sm ${podium.row}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${podium.rankBadge}`}
        >
          {row.rank}
        </span>
        <div className="min-w-0">
          <TeamNameWithPlayers
            name={row.team.name}
            color={row.team.color}
            players={row.players}
          />
          <p className="mt-0.5 pl-5 text-xs text-gray-500">
            {compact
              ? t('standings.record', { wins: row.wins, losses: row.losses })
              : t('standings.recordWithPlayed', {
                  wins: row.wins,
                  losses: row.losses,
                  played: row.played,
                })}
          </p>
        </div>
      </div>
      <div className="ml-3 shrink-0 text-right">
        <p className="text-xl font-bold text-green-700">{row.points}</p>
        <p className="text-[10px] uppercase tracking-wide text-gray-400">
          {t('common.pts')}
        </p>
      </div>
    </div>
  )
}

export function StandingsTable({ rows, compact = false }: StandingsTableProps) {
  const { t } = useTranslation()

  if (rows.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-gray-500">{t('standings.empty')}</p>
    )
  }

  return (
    <>
      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <StandingCard key={row.team.id} row={row} compact={compact} />
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-green-200 bg-white shadow-sm md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-green-100 bg-green-50 text-left text-xs uppercase tracking-wide text-green-800">
              <th className="px-4 py-3 font-semibold">#</th>
              <th className="px-4 py-3 font-semibold">{t('standings.team')}</th>
              {!compact && (
                <th className="px-4 py-3 text-center font-semibold">
                  {t('standings.played')}
                </th>
              )}
              <th className="px-4 py-3 text-center font-semibold">
                {t('standings.wins')}
              </th>
              <th className="px-4 py-3 text-center font-semibold">
                {t('standings.losses')}
              </th>
              <th className="px-4 py-3 text-center font-semibold">
                {t('standings.points')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const podium = getPodiumStyles(row.rank, row.points)
              return (
                <tr
                  key={row.team.id}
                  className={`border-b border-gray-100 last:border-0 ${podium.row}`}
                >
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${podium.rankBadge}`}
                    >
                      {row.rank}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <TeamNameWithPlayers
                      name={row.team.name}
                      color={row.team.color}
                      players={row.players}
                    />
                  </td>
                  {!compact && (
                    <td className="px-4 py-3 text-center text-gray-600">{row.played}</td>
                  )}
                  <td className="px-4 py-3 text-center text-gray-600">{row.wins}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{row.losses}</td>
                  <td className="px-4 py-3 text-center font-bold text-green-700">
                    {row.points}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

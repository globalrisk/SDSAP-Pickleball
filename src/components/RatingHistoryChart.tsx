import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMatchDate } from '../lib/formatDate'
import { roundRating } from '../lib/ratings'
import type { RatingHistoryPoint } from '../types'

interface RatingHistoryChartProps {
  points: RatingHistoryPoint[]
}

export function RatingHistoryChart({ points }: RatingHistoryChartProps) {
  const { t, i18n } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const chart = useMemo(() => {
    if (points.length === 0) return null

    const width = 640
    const height = 220
    const padX = 36
    const padY = 28
    const ratings = points.map((point) => point.rating)
    const min = Math.min(...ratings)
    const max = Math.max(...ratings)
    const span = Math.max(max - min, 40)
    const lo = min - span * 0.1
    const hi = max + span * 0.1

    const coords = points.map((point, index) => {
      const x =
        points.length === 1
          ? width / 2
          : padX + (index / (points.length - 1)) * (width - padX * 2)
      const y = padY + (1 - (point.rating - lo) / (hi - lo)) * (height - padY * 2)
      const prev = index > 0 ? points[index - 1] : null
      const delta = prev ? point.rating - prev.rating : null
      return { x, y, point, delta }
    })

    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ')
    const area =
      coords.length > 0
        ? `${line} L ${coords[coords.length - 1]!.x} ${height - padY} L ${coords[0]!.x} ${height - padY} Z`
        : ''

    return { width, height, padY, lo, hi, coords, line, area }
  }, [points])

  if (!chart || points.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500">{t('profile.noHistory')}</p>
    )
  }

  const selected =
    chart.coords.find((c) => c.point.id === selectedId) ?? chart.coords[chart.coords.length - 1]
  const selectedDate = selected
    ? formatMatchDate(selected.point.resultRecordedAt, i18n.language)
    : null

  return (
    <div className="w-full">
      <p className="mb-2 text-xs text-gray-500 sm:hidden">{t('profile.chartTapHint')}</p>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          className="h-56 w-full min-w-[280px]"
          role="img"
          aria-label={t('profile.chartLabel')}
        >
          <defs>
            <linearGradient id="ratingFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#16a34a" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#16a34a" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {[0, 0.5, 1].map((tValue) => {
            const y = chart.padY + tValue * (chart.height - chart.padY * 2)
            const rating = chart.hi - tValue * (chart.hi - chart.lo)
            return (
              <g key={tValue}>
                <line
                  x1="36"
                  x2={chart.width - 12}
                  y1={y}
                  y2={y}
                  stroke="#dcfce7"
                  strokeWidth="1"
                />
                <text x="4" y={y + 4} className="fill-gray-400 text-[10px]">
                  {roundRating(rating)}
                </text>
              </g>
            )
          })}

          <path d={chart.area} fill="url(#ratingFill)" />
          <path
            d={chart.line}
            fill="none"
            stroke="#16a34a"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />

          {chart.coords.map(({ x, y, point }) => {
            const active = selected?.point.id === point.id
            return (
              <g key={point.id}>
                <circle
                  cx={x}
                  cy={y}
                  r={active ? 18 : 14}
                  fill="transparent"
                  className="cursor-pointer"
                  onClick={() => setSelectedId(point.id)}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={active ? 6 : 4.5}
                  fill={
                    point.result === 'W'
                      ? '#16a34a'
                      : point.result === 'L'
                        ? '#dc2626'
                        : '#64748b'
                  }
                  stroke="white"
                  strokeWidth="2"
                  className="pointer-events-none"
                />
              </g>
            )
          })}
        </svg>
      </div>

      {selected && (
        <div className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900">
          {selected.point.result ? (
            <p>
              <span
                className={`font-bold ${
                  selected.point.result === 'W' ? 'text-green-700' : 'text-red-600'
                }`}
              >
                {selected.point.result}
              </span>
              {selected.point.seasonName ? ` · ${selected.point.seasonName}` : ''}
              {selectedDate ? ` · ${selectedDate}` : ''}
              {' · '}
              {roundRating(selected.point.rating)}
              {selected.delta != null ? (
                <span
                  className={`ml-1 font-semibold ${
                    selected.delta > 0
                      ? 'text-green-700'
                      : selected.delta < 0
                        ? 'text-red-600'
                        : 'text-gray-600'
                  }`}
                >
                  ({selected.delta > 0 ? '+' : ''}
                  {roundRating(selected.delta)})
                </span>
              ) : null}
            </p>
          ) : (
            <p>{t('profile.startingRating', { rating: roundRating(selected.point.rating) })}</p>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-green-600" /> {t('profile.legendWin')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-600" /> {t('profile.legendLoss')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-500" /> {t('profile.legendStart')}
        </span>
      </div>
    </div>
  )
}

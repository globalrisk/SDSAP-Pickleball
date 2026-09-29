import { TRUESKILL_DEFAULTS } from './ratings'

export interface HistoricalRatingRow {
  pool_player_id: string
  match_id: string | null
  rating: number
  rating_deviation: number
  sequence: number
}

/** Resolve only evidence strictly before each match, including skipped-season rows. */
export function buildPreMatchRatings(
  history: HistoricalRatingRow[],
  seeds: ReadonlyMap<string, { rating: number; rd: number }> = new Map(),
  fallback: { rating: number; rd: number } = TRUESKILL_DEFAULTS,
) {
  const current = new Map(seeds)
  const result = new Map<string, { rating: number; rd: number }>()
  for (const row of [...history].sort((a, b) => a.sequence - b.sequence)) {
    if (row.match_id) {
      const key = `${row.match_id}:${row.pool_player_id}`
      if (!result.has(key)) {
        result.set(key, { ...(current.get(row.pool_player_id) ?? fallback) })
      }
    }
    current.set(row.pool_player_id, { rating: row.rating, rd: row.rating_deviation })
  }
  return result
}

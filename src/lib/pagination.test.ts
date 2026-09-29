import { describe, expect, it } from 'vitest'
import { fetchAllPages } from './pagination'

describe('complete history reads', () => {
  it('reads beyond 1,000 rows even when the server cap is below the requested page size', async () => {
    const rows = Array.from({ length: 1241 }, (_, id) => ({ id }))
    const result = await fetchAllPages(async (from, to) => ({
      data: rows.slice(from, Math.min(to + 1, from + 200)), error: null,
    }))
    expect(result.data).toEqual(rows)
  })

  it('fails instead of returning incomplete history when a later page errors', async () => {
    const error = { message: 'connection lost' }
    await expect(fetchAllPages(async (from) => from === 0
      ? { data: [{ id: 1 }], error: null }
      : { data: null, error },
    )).rejects.toEqual(error)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { createDuelFeasibilityState, findFeasibleDuelSquads } from './fastDuelSearch'
import type { DuelSearchInput, DuelScheduleOption } from './flexibleDuel'
const request = vi.hoisted(() => vi.fn())
vi.mock('./fastDuelApi', () => ({ requestFastDuel: request }))
const ids = Array.from({ length: 8 }, (_, i) => `p${i}`)
const input: DuelSearchInput = { pool: ids.map(id => ({ id, name: id, rating: 1500, rating_deviation: 100, status: 'active', initial_rating: 1500, volatility: 0, created_at: '' })), settings: { maxPartnerMeetings: 2, maxOpponentMeetings: 3, maxMatchProbability: .65 }, partnerHistory: [], inputKey: 'ratings-and-conditions' }
const identities: string[] = []
for (let a = 1; a < 6; a++) for (let b = a + 1; b < 7; b++) for (let c = b + 1; c < 8; c++) {
  const side = ['p0', ids[a]!, ids[b]!, ids[c]!]
  identities.push(side.join(':') + '|' + ids.filter(id => !side.includes(id)).join(':'))
}
const context = { leagueId: 'league', seasonId: 'season', revision: 1, fingerprint: 'fp' }
const empty = (proven: string[], status = 'UNKNOWN') => ({ options: [], status, scope: 'roster', totalSplits: 35, provenInfeasibleSplitIds: proven })
const run = (state = createDuelFeasibilityState(), signal = new AbortController().signal) => findFeasibleDuelSquads(input, context, [], state, signal, vi.fn(), vi.fn())

describe('whole-roster condition checking', () => {
  it('combines batches and declares impossibility only after all unique splits are proved', async () => {
    request.mockReset().mockResolvedValueOnce(empty(identities.slice(0, 15))).mockResolvedValueOnce(empty(identities.slice(15)))
    const result = await run()
    expect(result.status).toBe('INFEASIBLE')
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1]![6].skipSplitIds).toEqual(identities.slice(0, 15))
  })
  it('does not turn a partial or repeated proof into a global impossibility claim', async () => {
    request.mockReset().mockResolvedValue(empty([identities[0]!], 'INFEASIBLE'))
    const state = createDuelFeasibilityState(), result = await run(state)
    expect(result.status).toBe('UNKNOWN')
    expect(state.proven.size).toBe(1)
    expect(request).toHaveBeenCalledTimes(3)
  })
  it('resumes after an unfinished check while keeping timed-out splits eligible', async () => {
    request.mockReset().mockResolvedValue(empty([]))
    const state = createDuelFeasibilityState()
    expect((await run(state)).status).toBe('UNKNOWN')
    expect(state.attempt).toBe(3)
    request.mockResolvedValueOnce(empty(identities))
    expect((await run(state)).status).toBe('INFEASIBLE')
    expect(request.mock.calls[3]![6].skipSplitIds).toEqual([])
    expect(request.mock.calls[3]![6].attempt).toBe(3)
  })
  it('returns only a verified squad with a completed schedule', async () => {
    const split = { id: identities[1]!, squads: [identities[1]!.split('|')[0]!.split(':'), identities[1]!.split('|')[1]!.split(':')] }
    request.mockReset().mockResolvedValue({ ...empty([]), status: 'FEASIBLE', split, options: [{ id: 'verified' } as DuelScheduleOption] })
    const result = await run()
    expect(result.split).toEqual(split)
    expect(result.options).toHaveLength(1)
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('keeps a previously verified schedule when a later shuffle remains unfinished', async () => {
    const state = createDuelFeasibilityState()
    const split = { id: identities[0]!, squads: [identities[0]!.split('|')[0]!.split(':'), identities[0]!.split('|')[1]!.split(':')] }
    request.mockReset().mockResolvedValueOnce({ ...empty([]), status: 'FEASIBLE', split, options: [{ id: 'verified' } as DuelScheduleOption] })
    await run(state)
    request.mockResolvedValue(empty([]))
    const result = await run(state)
    expect(result.status).toBe('FEASIBLE')
    expect(result.split).toEqual(split)
    expect(result.reused).toBe(true)
  })
  it('honors cancellation without starting another batch', async () => {
    request.mockReset()
    const controller = new AbortController(); controller.abort()
    await expect(run(createDuelFeasibilityState(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(request).not.toHaveBeenCalled()
  })
})

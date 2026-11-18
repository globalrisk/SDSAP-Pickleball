import { describe, expect, it, vi } from 'vitest'
import { createDuelFeasibilityState, findFeasibleDuelSquads } from './fastDuelSearch'
import type { DuelScheduleOption, DuelSearchInput } from './flexibleDuel'

const request = vi.hoisted(() => vi.fn())
vi.mock('./fastDuelApi', () => ({ requestFastDuel: request }))
const ids = Array.from({ length: 8 }, (_, i) => 'p' + i)
const input: DuelSearchInput = { pool: ids.map(id => ({ id, name: id, rating: 1500, rating_deviation: 100, status: 'active', initial_rating: 1500, volatility: 0, created_at: '' })), settings: { maxPartnerMeetings: 2, maxOpponentMeetings: 3, maxMatchProbability: .65 }, partnerHistory: [], inputKey: 'ratings-and-conditions' }
const identities: string[] = []
for (let a = 1; a < 6; a++) for (let b = a + 1; b < 7; b++) for (let c = b + 1; c < 8; c++) {
  const side = ['p0', ids[a]!, ids[b]!, ids[c]!]
  identities.push(side.join(':') + '|' + ids.filter(id => !side.includes(id)).join(':'))
}
const context = { leagueId: 'league', seasonId: 'season', revision: 1, fingerprint: 'fp' }
const empty = (proven: string[], status = 'UNKNOWN') => ({ status, totalSplits: 35, provenInfeasibleSplitIds: proven })
const run = (state = createDuelFeasibilityState(), history: { seen: string[]; current?: string } = { seen: [] }, signal = new AbortController().signal) =>
  findFeasibleDuelSquads(input, context, history, state, signal, vi.fn())

describe('resumable roster search', () => {
  it('uses a single request per search and resumes with only proven failures', async () => {
    request.mockReset().mockResolvedValueOnce(empty(identities.slice(0, 15))).mockResolvedValueOnce(empty(identities.slice(15)))
    const state = createDuelFeasibilityState()
    expect((await run(state)).status).toBe('UNKNOWN')
    expect(request).toHaveBeenCalledTimes(1)
    expect((await run(state)).status).toBe('INFEASIBLE')
    expect(request.mock.calls[1]![2]).toMatchObject({ skipSplitIds: identities.slice(0, 15), attempt: 1 })
  })

  it('does not turn a partial or repeated proof into a roster impossibility claim', async () => {
    request.mockReset().mockResolvedValue(empty([identities[0]!], 'INFEASIBLE'))
    const state = createDuelFeasibilityState()
    expect((await run(state)).status).toBe('UNKNOWN')
    expect((await run(state)).status).toBe('UNKNOWN')
    expect(state.proven.size).toBe(1)
  })

  it('returns only a verified preview and rejects a contradictory proof', async () => {
    const id = identities[1]!
    const preview = { split: { id, squads: id.split('|').map(side => side.split(':')) }, option: { kind: 'variety' } as DuelScheduleOption }
    request.mockReset().mockResolvedValueOnce({ ...empty([]), preview }).mockResolvedValueOnce({ ...empty([id]), preview })
    const state = createDuelFeasibilityState()
    expect((await run(state)).preview).toEqual(preview)
    await expect(run(state)).rejects.toThrow('SOLVER_INVALID_RESULT')
    expect(state.proven.size).toBe(0)
  })

  it('distinguishes a fully exhausted shuffle from an unfinished search', async () => {
    const [current, ...alternates] = identities
    request.mockReset().mockResolvedValueOnce(empty(alternates.slice(0, -1))).mockResolvedValueOnce(empty(alternates.slice(-1)))
    const state = createDuelFeasibilityState(), history = { seen: [current!], current }
    expect((await run(state, history)).status).toBe('UNKNOWN')
    expect((await run(state, history)).status).toBe('INFEASIBLE')
    expect(request.mock.calls[1]![2].currentSplitId).toBe(current)
  })

  it('honors cancellation without accepting additional proofs', async () => {
    const state = createDuelFeasibilityState(), controller = new AbortController()
    request.mockReset().mockImplementation(async () => { controller.abort(); return empty(identities) })
    await expect(run(state, { seen: [] }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(state.proven.size).toBe(0)
    await expect(run(state, { seen: [] }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(request).toHaveBeenCalledTimes(1)
  })
})

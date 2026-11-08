import { findDuelSchedule } from './testFixtures/flexibleDuelReference'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestFastDuel } from './fastDuelApi'
import type { DuelSearchInput, DuelSplit } from './flexibleDuel'

vi.mock('./supabase', () => ({ supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'test-access-token' } }, error: null })) } } }))
const input = { inputKey: 'key', pool: [], partnerHistory: [], settings: { maxPartnerMeetings: 2, maxOpponentMeetings: 2 } } as DuelSearchInput
const split = { id: 'split', squads: [[], []], bestWorst: 1 } as DuelSplit
const context = { leagueId: 'league', seasonId: 'season', revision: 1, fingerprint: 'fp' }
afterEach(() => { vi.unstubAllGlobals() })

describe('Fast solver stream transport', () => {
  it('sends authentication and stale-input context, and reads chunked progress/results', async () => {
    const encoder = new TextEncoder(), progress = vi.fn(), signal = new AbortController().signal
    const fetch = vi.fn(async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode('{"type":"progress","profile":"bal'))
      controller.enqueue(encoder.encode('ance"}\n{"type":"result","result":{"options":[],"status":"UNKNOWN"}}\n'))
      controller.close()
    } }), { headers: { 'Content-Type': 'application/x-ndjson' } }))
    vi.stubGlobal('fetch', fetch)
    expect(await requestFastDuel(input, split, context, [], signal, progress)).toEqual({ options: [], status: 'UNKNOWN' })
    expect(progress).toHaveBeenCalledWith('balance')
    const request = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(request[0]).toBe('/api/duel-solve')
    expect(request[1].signal).toBe(signal)
    expect(request[1].headers).toHaveProperty('Authorization', 'Bearer test-access-token')
    expect(JSON.parse(request[1].body as string)).toMatchObject(context)
  })
  it('rejects server errors and truncated streams instead of returning an empty success', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":"SOLVER_FORBIDDEN"}', { status: 403 }))
    await expect(requestFastDuel(input, split, context, [], new AbortController().signal, vi.fn())).rejects.toThrow('FORBIDDEN')
    vi.stubGlobal('fetch', async () => new Response('{"type":"heartbeat"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } }))
    await expect(requestFastDuel(input, split, context, [], new AbortController().signal, vi.fn())).rejects.toThrow('UNAVAILABLE')
  })
})

const rosterInput: DuelSearchInput = { inputKey: 'current', pool: Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, rating: 1500, rating_deviation: 100, status: 'active', initial_rating: 1500, volatility: 0, created_at: '' })), settings: { maxPartnerMeetings: 2, maxOpponentMeetings: 3, maxMatchProbability: .65 }, partnerHistory: [] }
const serverSquads = [rosterInput.pool.slice(0, 4), rosterInput.pool.slice(4)] as [typeof rosterInput.pool, typeof rosterInput.pool]
const globalRequest = () => ({ seenSplitIds: [], skipSplitIds: [], attempt: 0, onSearchProgress: vi.fn() })
const globalResponse = (patch = {}) => ({ scope: 'roster', totalSplits: 35, provenInfeasibleSplitIds: [], status: 'UNKNOWN', options: [], ...patch })
const respond = (result: unknown) => vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ type: 'result', result }) + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } }))

describe('validated squad-search transport', () => {
  it('uses the squads returned with a valid schedule instead of a random client split', async () => {
    const games = findDuelSchedule(serverSquads, rosterInput.settings, .500001)!
    respond(globalResponse({ status: 'FEASIBLE', squads: serverSquads.map(s => s.map(p => p.id)), options: [{ kind: 'balance', games, solver: { status: 'FEASIBLE', elapsedMs: 100 } }] }))
    const result = await requestFastDuel(rosterInput, undefined, context, [], new AbortController().signal, vi.fn(), globalRequest())
    expect(result.split?.squads).toEqual(serverSquads.map(s => s.map(p => p.id)))
    expect(result.options).toHaveLength(1)
  })
  it('does not return squads for an unfinished check', async () => {
    respond(globalResponse())
    const result = await requestFastDuel(rosterInput, undefined, context, [], new AbortController().signal, vi.fn(), globalRequest())
    expect(result.split).toBeUndefined()
    expect(result.options).toEqual([])
  })
  it('rejects duplicated, foreign or incomplete proof metadata', async () => {
    const identity = 'p0:p1:p2:p3|p4:p5:p6:p7'
    for (const patch of [{ provenInfeasibleSplitIds: [identity, identity] }, { provenInfeasibleSplitIds: ['foreign'] }, { totalSplits: 34 }]) {
      respond(globalResponse(patch))
      await expect(requestFastDuel(rosterInput, undefined, context, [], new AbortController().signal, vi.fn(), globalRequest())).rejects.toThrow('SOLVER_INVALID_RESULT')
    }
  })
})

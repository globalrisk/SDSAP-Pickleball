import { findDuelSchedule } from './testFixtures/flexibleDuelReference'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestFastDuel } from './fastDuelApi'
import type { DuelSearchInput } from './flexibleDuel'

vi.mock('./supabase', () => ({ supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'test-access-token' } }, error: null })) } } }))
const input: DuelSearchInput = { inputKey: 'current', pool: Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, rating: 1500, rating_deviation: 100, status: 'active', initial_rating: 1500, volatility: 0, created_at: '' })), settings: { maxPartnerMeetings: 2, maxOpponentMeetings: 3, maxMatchProbability: .65 }, partnerHistory: [] }
const squads: [typeof input.pool, typeof input.pool] = [input.pool.slice(0, 4), input.pool.slice(4)]
const squadIds = squads.map(s => s.map(p => p.id))
const identity = 'p0:p1:p2:p3|p4:p5:p6:p7'
const context = { leagueId: 'league', seasonId: 'season', revision: 1, fingerprint: 'fp' }
const request = { seenSplitIds: [], skipSplitIds: [], attempt: 0 }
const headers = { 'Content-Type': 'application/x-ndjson' }
const response = (patch = {}) => ({ scope: 'roster', totalSplits: 35, provenInfeasibleSplitIds: [], status: 'UNKNOWN', options: [], ...patch })
const respond = (result: unknown) => vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ type: 'result', result }) + '\n', { headers }))
afterEach(() => { vi.unstubAllGlobals() })

describe('schedule solver stream transport', () => {
  it('sends authentication and stale-input context, and reads chunked progress/results', async () => {
    const encoder = new TextEncoder(), progress = vi.fn(), signal = new AbortController().signal
    const fetch = vi.fn(async (_url: string, _args: RequestInit) => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode('{"type":"squadPro'))
      controller.enqueue(encoder.encode('gress","phase":"optimizing","checked":2,"total":35}\n' + JSON.stringify({ type: 'result', result: response() }) + '\n'))
      controller.close()
    } }), { headers }))
    vi.stubGlobal('fetch', fetch)
    expect(await requestFastDuel(input, context, request, signal, progress)).toEqual({ status: 'UNKNOWN', totalSplits: 35, provenInfeasibleSplitIds: [] })
    expect(progress).toHaveBeenCalledWith({ phase: 'optimizing', checked: 2, total: 35 })
    const [url, args] = fetch.mock.calls[0]!
    expect(url).toBe('/api/duel-solve')
    expect(args.signal).toBe(signal)
    expect(args.headers).toHaveProperty('Authorization', 'Bearer test-access-token')
    expect(JSON.parse(args.body as string)).toMatchObject({ ...context, searchMode: 'generate', settings: input.settings })
  })
  it('rejects server errors and truncated streams', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":"SOLVER_FORBIDDEN"}', { status: 403 }))
    await expect(requestFastDuel(input, context, request, new AbortController().signal, vi.fn())).rejects.toThrow('FORBIDDEN')
    vi.stubGlobal('fetch', async () => new Response('{"type":"heartbeat"}\n', { headers }))
    await expect(requestFastDuel(input, context, request, new AbortController().signal, vi.fn())).rejects.toThrow('UNAVAILABLE')
  })
  it('accepts a single verified schedule and rejects multiple options, invalid proof scopes, or a shuffle of the current split', async () => {
    const games = findDuelSchedule(squads, input.settings, .500001)!
    const option = { kind: 'variety', games, solver: { status: 'FEASIBLE', elapsedMs: 100, coverageProof: 'roster' } }
    const run = (search = request) => requestFastDuel(input, context, search, new AbortController().signal, vi.fn())
    respond(response({ status: 'FEASIBLE', squads: squadIds, options: [option] }))
    const result = await run()
    expect(result.preview?.split.squads).toEqual(squadIds)
    expect(result.preview?.option.solver?.coverageProof).toBe('roster')
    const shuffle = { ...request, currentSplitId: identity }
    await expect(run(shuffle)).rejects.toThrow('SOLVER_INVALID_RESULT')
    respond(response({ status: 'FEASIBLE', squads: squadIds, options: [option, option] }))
    await expect(run()).rejects.toThrow('SOLVER_INVALID_RESULT')
    respond(response({ status: 'FEASIBLE', squads: squadIds, options: [{ ...option, solver: { ...option.solver, coverageProof: 'squads' } }] }))
    await expect(run()).rejects.toThrow('SOLVER_INVALID_RESULT')
  })
  it('rejects duplicated, foreign or incomplete proof metadata', async () => {
    for (const patch of [{ provenInfeasibleSplitIds: [identity, identity] }, { provenInfeasibleSplitIds: ['foreign'] }, { totalSplits: 34 }]) {
      respond(response(patch))
      await expect(requestFastDuel(input, context, request, new AbortController().signal, vi.fn())).rejects.toThrow('SOLVER_INVALID_RESULT')
    }
  })
})

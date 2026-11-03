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

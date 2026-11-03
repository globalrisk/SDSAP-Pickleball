import { supabase } from './supabase'
import { decodeFastDuelOptions } from './fastDuel'
import type { DuelSearchInput, DuelSplit } from './flexibleDuel'

export async function requestFastDuel(input: DuelSearchInput, split: DuelSplit, context: { leagueId: string; seasonId: string; revision: number; fingerprint: string }, excludedIds: string[], signal: AbortSignal, onProgress: (profile: string) => void) {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session) throw new Error('SOLVER_UNAUTHORIZED')
  const response = await fetch('/api/duel-solve', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify({ ...context, squads: split.squads, settings: input.settings, excludedIds }) })
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(error.error ?? 'SOLVER_UNAVAILABLE')
  }
  if (!response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) throw new Error('SOLVER_UNAVAILABLE')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      if (buffer.length > 1_000_000) throw new Error('SOLVER_INVALID_RESULT')
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        if (!line.trim()) continue
        const event = JSON.parse(line)
        if (event.type === 'error') throw new Error(event.error ?? 'SOLVER_FAILED')
        if (event.type === 'progress') onProgress(event.profile)
        if (event.type === 'result') {
          if (!event.result) throw new Error('SOLVER_CANCELLED')
          return { options: decodeFastDuelOptions(input, split, event.result.options), status: String(event.result.status) }
        }
      }
      if (done) break
    }
    throw new Error('SOLVER_UNAVAILABLE')
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

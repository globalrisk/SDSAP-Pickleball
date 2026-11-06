import { supabase } from './supabase'
import { decodeFastDuelOptions, decodeFastDuelSplit, fastDuelSplitCount, isFastDuelSplitId } from './fastDuel'
import type { DuelScheduleOption, DuelSearchInput, DuelSplit } from './flexibleDuel'

export interface FastDuelResult {
  options: DuelScheduleOption[]; status: string; split?: DuelSplit
  scope?: 'roster'; totalSplits?: number; provenInfeasibleSplitIds?: string[]; reused?: boolean
}
export interface FastDuelShuffleRequest {
  seenSplitIds: string[]; skipSplitIds: string[]; attempt: number
  onSearchProgress: (checked: number, total: number) => void
}

export async function requestFastDuel(input: DuelSearchInput, split: DuelSplit | undefined, context: { leagueId: string; seasonId: string; revision: number; fingerprint: string }, excludedIds: string[], signal: AbortSignal, onProgress: (profile: string) => void, search?: FastDuelShuffleRequest): Promise<FastDuelResult> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session) throw new Error('SOLVER_UNAUTHORIZED')
  const response = await fetch('/api/duel-solve', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify({ ...context, squads: split?.squads, settings: input.settings, excludedIds, searchMode: search ? 'shuffle' : undefined, seenSplitIds: search?.seenSplitIds, skipSplitIds: search?.skipSplitIds, attempt: search?.attempt }) })
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
        if (event.type === 'squadProgress' && search) {
          const total = fastDuelSplitCount(input.pool.length / 2)
          if (event.total !== total || !Number.isInteger(event.checked) || event.checked < 0 || event.checked > total) throw new Error('SOLVER_INVALID_RESULT')
          search.onSearchProgress(event.checked, total)
        }
        if (event.type === 'result') {
          if (!event.result) throw new Error('SOLVER_CANCELLED')
          if (search) {
            const result = event.result, total = fastDuelSplitCount(input.pool.length / 2)
            if (result.scope !== 'roster' || result.totalSplits !== total || !Array.isArray(result.options) || result.options.length > 3
              || !Array.isArray(result.provenInfeasibleSplitIds) || result.provenInfeasibleSplitIds.length > total
              || new Set(result.provenInfeasibleSplitIds).size !== result.provenInfeasibleSplitIds.length
              || !result.provenInfeasibleSplitIds.every((id: unknown) => isFastDuelSplitId(input, id))) throw new Error('SOLVER_INVALID_RESULT')
            const found = result.options.length ? decodeFastDuelSplit(input, result.squads) : undefined
            const options = found ? decodeFastDuelOptions(input, found, result.options) : []
            if (found) found.bestWorst = options[0]!.metrics.worstFavorite
            return { options, status: String(result.status), split: found, scope: 'roster', totalSplits: total, provenInfeasibleSplitIds: result.provenInfeasibleSplitIds }
          }
          if (!split) throw new Error('SOLVER_INVALID_RESULT')
          return { options: decodeFastDuelOptions(input, split, event.result.options), status: String(event.result.status) }
        }
      }
      if (done) break
    }
    throw new Error('SOLVER_UNAVAILABLE')
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

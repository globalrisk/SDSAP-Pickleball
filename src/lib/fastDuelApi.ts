import { supabase } from './supabase'
import { decodeFastDuelOption, decodeFastDuelSplit, fastDuelSplitCount, isFastDuelSplitId } from './fastDuel'
import type { DuelScheduleOption, DuelSearchInput, DuelSplit } from './flexibleDuel'

export interface FastDuelResult {
  preview?: { split: DuelSplit; option: DuelScheduleOption }
  status: 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN'
  totalSplits: number
  provenInfeasibleSplitIds: string[]
}
export interface DuelSearchProgress {
  phase: 'screening' | 'optimizing'; checked: number; total: number
}
export interface DuelRequestContext { leagueId: string; seasonId: string; revision: number; fingerprint: string }
interface FastDuelSearchRequest {
  seenSplitIds: string[]; skipSplitIds: string[]; attempt: number; currentSplitId?: string
}

export async function requestFastDuel(input: DuelSearchInput, context: DuelRequestContext, search: FastDuelSearchRequest, signal: AbortSignal, onProgress: (progress: DuelSearchProgress) => void): Promise<FastDuelResult> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session) throw new Error('SOLVER_UNAUTHORIZED')
  const total = fastDuelSplitCount(input.pool.length / 2)
  const response = await fetch('/api/duel-solve', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify({ ...context, ...search, settings: input.settings, searchMode: search.currentSplitId ? 'shuffle' : 'generate' }) })
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
        if (event.type === 'squadProgress') {
          if ((event.phase !== 'screening' && event.phase !== 'optimizing') || event.total !== total
            || !Number.isInteger(event.checked) || event.checked < 0 || event.checked > total) throw new Error('SOLVER_INVALID_RESULT')
          onProgress({ phase: event.phase, checked: event.checked, total })
        }
        if (event.type === 'result') {
          const result = event.result
          if (!result) throw new Error('SOLVER_CANCELLED')
          if (result.scope !== 'roster' || result.totalSplits !== total || !Array.isArray(result.options) || result.options.length > 1
            || !['FEASIBLE', 'INFEASIBLE', 'UNKNOWN'].includes(result.status) || (result.status === 'FEASIBLE') !== (result.options.length === 1)
            || !Array.isArray(result.provenInfeasibleSplitIds) || result.provenInfeasibleSplitIds.length > total
            || new Set(result.provenInfeasibleSplitIds).size !== result.provenInfeasibleSplitIds.length
            || !result.provenInfeasibleSplitIds.every((id: unknown) => isFastDuelSplitId(input, id))) throw new Error('SOLVER_INVALID_RESULT')
          const summary = { status: result.status, totalSplits: total, provenInfeasibleSplitIds: result.provenInfeasibleSplitIds }
          if (!result.options.length) return summary
          const split = decodeFastDuelSplit(input, result.squads)
          const option = decodeFastDuelOption(input, split, result.options[0])
          const proof = option.solver?.coverageProof
          if (split.id === search.currentSplitId || (proof && proof !== (search.currentSplitId ? 'squads' : 'roster'))) throw new Error('SOLVER_INVALID_RESULT')
          return { ...summary, preview: { split, option } }
        }
      }
      if (done) break
    }
    throw new Error('SOLVER_UNAVAILABLE')
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

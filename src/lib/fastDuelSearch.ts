import { fastDuelSplitCount } from './fastDuel'
import { requestFastDuel, type FastDuelResult } from './fastDuelApi'
import type { DuelSearchInput } from './flexibleDuel'

export interface DuelFeasibilityState { proven: Set<string>; attempt: number; known?: FastDuelResult }
export const createDuelFeasibilityState = (): DuelFeasibilityState => ({ proven: new Set(), attempt: 0 })

/** Only server-proved splits are skipped. Timeouts remain eligible for later checks. */
export async function findFeasibleDuelSquads(input: DuelSearchInput, context: { leagueId: string; seasonId: string; revision: number; fingerprint: string }, seen: string[], state: DuelFeasibilityState, signal: AbortSignal, onProfile: (profile: string) => void, onProgress: (checked: number, total: number) => void): Promise<FastDuelResult> {
  const total = fastDuelSplitCount(input.pool.length / 2)
  for (let batch = 0; batch < 3 && state.proven.size < total; batch++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const result = await requestFastDuel(input, undefined, context, [], signal, onProfile, {
      seenSplitIds: seen, skipSplitIds: [...state.proven], attempt: Math.min(state.attempt, 6), onSearchProgress: onProgress,
    })
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    state.attempt++
    for (const id of result.provenInfeasibleSplitIds ?? []) {
      if (id === state.known?.split?.id) throw new Error('SOLVER_INVALID_RESULT')
      state.proven.add(id)
    }
    onProgress(state.proven.size, total)
    if (result.options.length) {
      if (!result.split || state.proven.has(result.split.id)) throw new Error('SOLVER_INVALID_RESULT')
      state.known = result
      return result
    }
  }
  if (state.known) return { ...state.known, reused: true }
  return { options: [], status: state.proven.size === total ? 'INFEASIBLE' : 'UNKNOWN', scope: 'roster', totalSplits: total, provenInfeasibleSplitIds: [...state.proven] }
}

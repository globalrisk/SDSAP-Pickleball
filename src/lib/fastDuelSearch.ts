import { requestFastDuel, type DuelRequestContext, type DuelSearchProgress, type FastDuelResult } from './fastDuelApi'
import type { DuelSearchInput } from './flexibleDuel'

export interface DuelFeasibilityState { proven: Set<string>; attempt: number }
export const createDuelFeasibilityState = (): DuelFeasibilityState => ({ proven: new Set(), attempt: 0 })

/** Only server-proved splits are skipped. Timeouts remain eligible for later checks. */
export async function findFeasibleDuelSquads(input: DuelSearchInput, context: DuelRequestContext, splitHistory: { seen: string[]; current?: string }, state: DuelFeasibilityState, signal: AbortSignal, onProgress: (progress: DuelSearchProgress) => void): Promise<FastDuelResult> {
  signal.throwIfAborted()
  const result = await requestFastDuel(input, context, {
    currentSplitId: splitHistory.current, seenSplitIds: splitHistory.seen,
    skipSplitIds: [...state.proven], attempt: Math.min(state.attempt, 6),
  }, signal, onProgress)
  signal.throwIfAborted()
  const proven = new Set([...state.proven, ...result.provenInfeasibleSplitIds])
  if (splitHistory.seen.some(id => proven.has(id)) || (splitHistory.current && proven.has(splitHistory.current))
    || (result.preview && proven.has(result.preview.split.id))) throw new Error('SOLVER_INVALID_RESULT')
  state.proven = proven
  state.attempt = result.preview ? 0 : state.attempt + 1
  const exhausted = proven.size === result.totalSplits - Number(Boolean(splitHistory.current))
  return { ...result, status: result.preview ? 'FEASIBLE' : exhausted ? 'INFEASIBLE' : 'UNKNOWN', provenInfeasibleSplitIds: [...proven] }
}

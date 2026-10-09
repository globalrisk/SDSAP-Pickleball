import type { DuelDraftPriority, Season, TeamWithPlayers } from '../types'
import type { LeagueDuelDraft, LeagueDuelDraftCandidates } from './leagueTeamDuel'

export const DUEL_DRAFT_PRIORITIES = ['balance', 'opponent_variety'] as const

export interface DuelDraftOptions {
  snapshotKey: string
  drafts: LeagueDuelDraft[]
  seen: Record<DuelDraftPriority, string[]>
  notices: Partial<Record<DuelDraftPriority, 'noAlternative' | 'restarted' | 'noEligible'>>
}

export function createDuelDraftOptions(
  snapshotKey: string, candidates: LeagueDuelDraftCandidates, saved?: LeagueDuelDraft,
): DuelDraftOptions {
  const result: DuelDraftOptions = { snapshotKey, drafts: [], seen: { balance: [], opponent_variety: [] }, notices: {} }
  for (const priority of DUEL_DRAFT_PRIORITIES) {
    const draft = candidates[priority].find(draft => draft.id === saved?.id) ?? candidates[priority][0]
    if (!draft) { result.notices[priority] = 'noEligible'; continue }
    result.drafts.push(draft)
    result.seen[priority] = [draft.splitId]
  }
  return result
}

/** Number of changed squadmates, treating mirrored squads as the same split. */
function squadDistance(first: LeagueDuelDraft, second: LeagueDuelDraft): number {
  const ids = new Set(first.squads[0].map((player) => player.id))
  const moved = second.squads[0].filter((player) => !ids.has(player.id)).length
  return Math.min(moved, first.squads[0].length - moved)
}

export function refreshDuelDraftOptions(
  previous: DuelDraftOptions, snapshotKey: string, candidates: LeagueDuelDraftCandidates,
): DuelDraftOptions {
  if (previous.snapshotKey !== snapshotKey) return createDuelDraftOptions(snapshotKey, candidates)
  const next: DuelDraftOptions = { snapshotKey, drafts: [], seen: { ...previous.seen }, notices: {} }
  for (const priority of DUEL_DRAFT_PRIORITIES) {
    const old = previous.drafts.find((draft) => draft.priority === priority)
    if (!candidates[priority].length) {
      next.notices[priority] = 'noEligible'
      next.seen[priority] = []
      continue
    }
    if (!old) {
      next.drafts.push(candidates[priority][0]!)
      next.seen[priority] = [candidates[priority][0]!.splitId]
      continue
    }
    const alternatives = candidates[priority].filter((draft) => draft.splitId !== old.splitId)
    let available = alternatives.filter((draft) => !previous.seen[priority].includes(draft.splitId))
    if (!alternatives.length) {
      next.notices[priority] = 'noAlternative'
      next.drafts.push(candidates[priority].find((draft) => draft.splitId === old.splitId) ?? candidates[priority][0]!)
      continue
    }
    if (!available.length) {
      next.notices[priority] = 'restarted'
      next.seen[priority] = [old.splitId]
      available = alternatives
    }
    // Keep the second card distinct when an unseen eligible split permits it.
    const other = next.drafts[0] ?? (candidates.opponent_variety.length === 1 ? candidates.opponent_variety[0] : undefined)
    const distinct = other ? available.filter((draft) => draft.splitId !== other.splitId) : available
    if (distinct.length) available = distinct
    // Candidate arrays are already ranked; stable sorting preserves that tie-break.
    available = available.toSorted((a, b) => squadDistance(old, b) - squadDistance(old, a))
    const selected = available[0]!
    next.drafts.push(selected)
    next.seen[priority] = [...next.seen[priority], selected.splitId]
  }
  if (next.drafts.length === 2 && next.drafts[0]!.splitId === next.drafts[1]!.splitId) {
    const old = previous.drafts.find(draft => draft.priority === 'balance')
    if (!old) return next
    const alternatives = candidates.balance.filter((draft) => draft.splitId !== old.splitId
      && draft.splitId !== next.drafts[1]!.splitId)
    const unseen = alternatives.filter((draft) => !previous.seen.balance.includes(draft.splitId))
    const available = (unseen.length ? unseen : alternatives)
      .toSorted((a, b) => squadDistance(old, b) - squadDistance(old, a))
    if (available[0]) {
      next.drafts[0] = available[0]
      next.seen.balance = [...(unseen.length ? previous.seen.balance : [old.splitId]), available[0].splitId]
      if (!unseen.length) next.notices.balance = 'restarted'
    }
  }
  return next
}

export function isSelectedDuelDraftSaved(
  selected: LeagueDuelDraft | undefined, season: Season, teams: TeamWithPlayers[],
  snapshot: { revision: number; fingerprint: string } | undefined,
): boolean {
  if (!selected || !snapshot || teams.length !== 2 || season.duel_schedule_mode !== 'tier_matched'
    || (season.duel_draft_priority ?? 'opponent_variety') !== selected.priority
    || season.duel_draft_rating_revision !== snapshot.revision
    || season.duel_draft_rating_fingerprint !== snapshot.fingerprint) return false
  const saved = teams.map((team) => team.players.map((player) => player.pool_player_id).sort().join(':')).sort()
  const chosen = selected.squads.map((squad) => squad.map((player) => player.id).sort().join(':')).sort()
  return saved.every((ids, index) => ids === chosen[index])
}

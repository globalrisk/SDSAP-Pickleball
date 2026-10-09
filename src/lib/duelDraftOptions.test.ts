import { describe, expect, it } from 'vitest'
import { generateLeagueDuelDraftCandidates } from './leagueTeamDuel'
import { createDuelDraftOptions, refreshDuelDraftOptions, isSelectedDuelDraftSaved } from './duelDraftOptions'
import { buildTierMatchedDuelSchedules, compareOpponentEncounters, duelOpponentMeetingCaps, duelTierForRank } from './leagueDuelSchedule'
import { season14DraftSnapshot } from './testFixtures/season14DraftSnapshot'
import type { PoolPlayer, Season, TeamWithPlayers } from '../types'
import { decisiveSeasonChances, isSeasonForecastBalanced, seasonForecastImbalance } from './seasonForecast'

const players: PoolPlayer[] = season14DraftSnapshot.ratings.map((rating, i) => ({
  id: `p${String(i + 1).padStart(2, '0')}`, name: `Player ${i + 1}`, status: 'active',
  rating: rating.rating, rating_deviation: rating.rd, initial_rating: 1500, volatility: 0, created_at: '',
}))
const history = season14DraftSnapshot.partnerHistory.map((pairs) => new Set(pairs
  .map((pair) => pair.map((index) => players[index]!.id).sort().join(':'))))
const candidates = generateLeagueDuelDraftCandidates(players, history)

describe('two draft priorities and bounded alternatives', () => {
  it('shows the actual Season 14 balance versus variety tradeoff', () => {
    const [balance, variety] = createDuelDraftOptions('snapshot', candidates).drafts
    expect(balance!.priority).toBe('balance')
    expect(variety!.priority).toBe('opponent_variety')
    expect(balance!.worstFavorite).toBeCloseTo(0.729350916746, 10)
    expect(candidates.balance).toHaveLength(11)
    expect(candidates.opponent_variety).toHaveLength(27)
    expect(balance!.schedule.opponentEncounterCounts[0]).toBe(4)
    expect(variety!.schedule.opponentEncounterCounts[0]).toBe(4)
    expect(balance!.squads[0].some((player) => player.id === players[1]!.id)).toBe(false)
    // The globally best individual-game draft is outside 55/45. Its original
    // quality baseline still applies; filtering must not loosen the 5-point band.
    const bestWorst = 0.713019644464
    for (const draft of candidates.balance) {
      expect(draft.worstFavorite).toBeLessThanOrEqual(bestWorst + 0.05 + 1e-12)
      expect(seasonForecastImbalance(draft.schedule.seasonForecast)).toBeGreaterThanOrEqual(seasonForecastImbalance(balance!.schedule.seasonForecast))
    }
    for (const draft of [...candidates.balance, ...candidates.opponent_variety]) {
      expect(isSeasonForecastBalanced(draft.schedule.seasonForecast)).toBe(true)
      const chances = decisiveSeasonChances(draft.schedule.seasonForecast)!
      expect(Math.max(chances.home, chances.away)).toBeLessThanOrEqual(0.55 + 1e-12)
      const caps = duelOpponentMeetingCaps(draft.squads[0].length)
      for (const [h, home] of draft.squads[0].entries()) for (const [a, away] of draft.squads[1].entries()) {
        const meetings = draft.schedule.games.filter(game => game.homePoolPlayerIds.includes(home.id) && game.awayPoolPlayerIds.includes(away.id)).length
        expect(meetings).toBeLessThanOrEqual(Math.min(caps[duelTierForRank(h + 1, 7)], caps[duelTierForRank(a + 1, 7)]))
      }
    }
    for (const draft of candidates.opponent_variety) {
      expect(compareOpponentEncounters(draft.schedule.opponentEncounterCounts, variety!.schedule.opponentEncounterCounts)).toBe(0)
      expect(draft.repeatedPartnerships).toBeLessThanOrEqual(18 + 6)
      expect(seasonForecastImbalance(draft.schedule.seasonForecast)).toBeGreaterThanOrEqual(seasonForecastImbalance(variety!.schedule.seasonForecast))
    }
  })

  it('caps the previously five-game middle-tier rivalry in the saved Season 14 squads', () => {
    const indices = new Set([0, 3, 5, 6, 9, 11, 12])
    const schedules = buildTierMatchedDuelSchedules([players.filter((_, i) => indices.has(i)), players.filter((_, i) => !indices.has(i))])
    // Anonymous snapshot indices 6 and 7 are the middle-tier rivalry reported by the user.
    for (const schedule of Object.values(schedules)) {
      expect(schedule.games.filter(game => game.homePoolPlayerIds.includes(players[6]!.id)
        && game.awayPoolPlayerIds.includes(players[7]!.id)).length).toBeLessThanOrEqual(3)
      expect(schedule.opponentEncounterCounts[0]).toBeLessThanOrEqual(4)
      expect(schedule.games).toHaveLength(21)
    }
  })

  it('refreshes both squad splits without leaving their quality pools or changing priorities', () => {
    let state = createDuelDraftOptions('snapshot', candidates)
    for (let i = 0; i < 5; i++) {
      const next = refreshDuelDraftOptions(state, 'snapshot', candidates)
      expect(next.drafts.map((draft) => draft.priority)).toEqual(['balance', 'opponent_variety'])
      next.drafts.forEach((draft, side) => {
        expect(draft.splitId).not.toBe(state.drafts[side]!.splitId)
        expect(candidates[draft.priority]).toContain(draft)
        expect(state.seen[draft.priority]).not.toContain(draft.splitId)
      })
      expect(next.drafts[0]!.splitId).not.toBe(next.drafts[1]!.splitId)
      state = next
    }
  })

  it('chooses the most changed unseen squads, with ranking breaking distance ties', () => {
    const state = createDuelDraftOptions('snapshot', candidates)
    const next = refreshDuelDraftOptions(state, 'snapshot', candidates)
    const old = new Set(state.drafts[0]!.squads[0].map((player) => player.id))
    const distance = (draft: typeof state.drafts[number]) => {
      const moved = draft.squads[0].filter((player) => !old.has(player.id)).length
      return Math.min(moved, 7 - moved)
    }
    const expected = candidates.balance.filter((draft) => draft.splitId !== state.drafts[0]!.splitId)
      .toSorted((a, b) => distance(b) - distance(a))[0]!
    expect(next.drafts[0]!.id).toBe(expected.id)
  })

  it('restarts exhausted pools without immediately repeating a split', () => {
    const limited = { balance: candidates.balance.slice(0, 2), opponent_variety: candidates.opponent_variety.slice(0, 2) }
    const initial = createDuelDraftOptions('snapshot', limited)
    const second = refreshDuelDraftOptions(initial, 'snapshot', limited)
    const third = refreshDuelDraftOptions(second, 'snapshot', limited)
    expect(third.notices).toEqual({ balance: 'restarted', opponent_variety: 'restarted' })
    third.drafts.forEach((draft, i) => expect(draft.splitId).not.toBe(second.drafts[i]!.splitId))
  })

  it('explains one-candidate pools and keeps both named options', () => {
    const limited = { balance: candidates.balance.slice(0, 1), opponent_variety: candidates.opponent_variety.slice(0, 1) }
    const state = createDuelDraftOptions('snapshot', limited)
    const next = refreshDuelDraftOptions(state, 'snapshot', limited)
    expect(next.drafts).toEqual(state.drafts)
    expect(next.notices).toEqual({ balance: 'noAlternative', opponent_variety: 'noAlternative' })
  })

  it('resets seen history when snapshot inputs change and restores a saved eligible option', () => {
    const old = refreshDuelDraftOptions(createDuelDraftOptions('old', candidates), 'old', candidates)
    expect(refreshDuelDraftOptions(old, 'new', candidates)).toEqual(createDuelDraftOptions('new', candidates))
    const saved = candidates.balance[2]!
    expect(createDuelDraftOptions('new', candidates, saved).drafts[0]).toBe(saved)
  })

  it('explains empty priority pools without relaxing bounds or restoring an ineligible saved option', () => {
    for (const priority of ['balance', 'opponent_variety'] as const) {
      const limited = { ...candidates, [priority]: [] }
      const state = createDuelDraftOptions('snapshot', limited, candidates[priority][0])
      expect(state.drafts).toHaveLength(1)
      expect(state.drafts[0]!.priority).not.toBe(priority)
      expect(state.notices[priority]).toBe('noEligible')
      expect(state.seen[priority]).toEqual([])
      const refreshed = refreshDuelDraftOptions(state, 'snapshot', limited)
      expect(refreshed.drafts).toHaveLength(1)
      expect(refreshed.notices[priority]).toBe('noEligible')
      expect(refreshed.drafts[0]!.splitId).not.toBe(state.drafts[0]!.splitId)
    }
    const empty = { balance: [], opponent_variety: [] }
    const old = createDuelDraftOptions('old', candidates)
    const state = refreshDuelDraftOptions(old, 'new', empty)
    expect(state.drafts).toEqual([])
    expect(state.notices).toEqual({ balance: 'noEligible', opponent_variety: 'noEligible' })
    expect(refreshDuelDraftOptions(state, 'new', empty)).toEqual(state)
    expect(refreshDuelDraftOptions(state, 'new', candidates).drafts).toHaveLength(2)
  })

  it('requires the selected split, priority, and rating snapshot to be saved', () => {
    const draft = candidates.balance[0]!
    const season = { duel_schedule_mode: 'tier_matched', duel_draft_priority: 'balance', duel_draft_rating_revision: 2,
      duel_draft_rating_fingerprint: 'rated' } as Season
    const teams = draft.squads.map((squad, i) => ({ id: `team${i}`, players: squad.map((player) => ({ pool_player_id: player.id })) })) as TeamWithPlayers[]
    expect(isSelectedDuelDraftSaved(draft, season, teams, { revision: 2, fingerprint: 'rated' })).toBe(true)
    expect(isSelectedDuelDraftSaved(draft, season, teams.toReversed(), { revision: 2, fingerprint: 'rated' })).toBe(true)
    expect(isSelectedDuelDraftSaved(draft, { ...season, duel_draft_priority: 'opponent_variety' }, teams, { revision: 2, fingerprint: 'rated' })).toBe(false)
    expect(isSelectedDuelDraftSaved(draft, season, teams, { revision: 3, fingerprint: 'rated' })).toBe(false)
    expect(isSelectedDuelDraftSaved(candidates.balance[1], season, teams, { revision: 2, fingerprint: 'rated' })).toBe(false)
    expect(isSelectedDuelDraftSaved(undefined, season, teams, undefined)).toBe(false)
  })
})

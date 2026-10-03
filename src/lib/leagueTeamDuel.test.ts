import { describe, expect, it } from 'vitest'
import { generateLeagueDuelDrafts, getLeagueDuelProgress } from './leagueTeamDuel'
import { assignLeagueDuelTiers, buildTierMatchedDuelSchedule, duelTierCounts } from './leagueDuelSchedule'
import { partnershipKey } from './balanceTeams'
import { generateLeagueTeamDuelSchedule, generateTeamDuelSchedule } from './teamDuelSchedule'
import { computeStandings } from './standings'
import { areAllMatchPlayersPresent, buildTournamentView, matchesShareTeam, shouldReleaseQueuedMatch } from './tournamentMode'
import { rankAvailableMatches } from './matchRecommendation'
import { replayRatings, type FinishedMatchForRatings } from './ratingReplay'
import { buildPersonalTournament } from './personalTournament'
import { buildPlayerMatchEvents } from './playerMatches'
import type { MatchWithTeams, PoolPlayer, TeamWithPlayers } from '../types'

function pool(count = 14): PoolPlayer[] {
  return Array.from({ length: count }, (_, i) => ({ id: `p${String(i + 1).padStart(2, '0')}`, name: `Player ${i + 1}`, status: 'active', rating: 1500, rating_deviation: 275, initial_rating: 1500, volatility: 0, created_at: '' }))
}
function fixtures(size = 7) {
  const players = pool(size * 2)
  const teams: TeamWithPlayers[] = ['home', 'away'].map((id, side) => ({ id, name: id, season_id: 'season', color: '#15803d', created_at: '', players: players.slice(side * size, (side + 1) * size).map((p, rank) => ({ id: p.id, pool_player_id: p.id, name: p.name, team_id: id, is_present: true, duel_rank: rank + 1, created_at: '' })) }))
  const matches: MatchWithTeams[] = generateLeagueTeamDuelSchedule(size).flatMap((r) => r.matches).map((game) => ({
    id: `game-${game.sequenceNumber}`, season_id: 'season', home_team_id: 'home', away_team_id: 'away',
    status: 'scheduled', live_status: 'available', live_court_number: null,
    home_score: null, away_score: null, winner_team_id: null, result_recorded_at: null, created_at: '', winner: null,
    round_number: game.roundNumber, duel_sequence_number: game.sequenceNumber,
    home_pool_player_ids: game.rankPair.map((rank) => teams[0]!.players[rank - 1]!.pool_player_id),
    away_pool_player_ids: game.rankPair.map((rank) => teams[1]!.players[rank - 1]!.pool_player_id),
    home_team: { ...teams[0]!, players: game.rankPair.map((rank) => teams[0]!.players[rank - 1]!) },
    away_team: { ...teams[1]!, players: game.rankPair.map((rank) => teams[1]!.players[rank - 1]!) },
  }))
  return { players, teams, matches }
}

describe('league duel schedule', () => {
  for (const size of [4, 5, 6, 7]) it(`covers all partnerships and mirrored byes for ${size}-player squads`, () => {
    const rounds = generateLeagueTeamDuelSchedule(size)
    const games = rounds.flatMap((r) => r.matches)
    const pairs = new Set(games.map((g) => [...g.rankPair].sort().join(':')))
    expect(games).toHaveLength(size * (size - 1) / 2)
    expect(pairs.size).toBe(games.length)
    expect(games.map((g) => g.sequenceNumber)).toEqual(Array.from({ length: games.length }, (_, i) => i + 1))
    for (let rank = 1; rank <= size; rank++) {
      expect(games.filter((g) => g.rankPair.includes(rank))).toHaveLength(size - 1)
      expect(rounds.filter((r) => r.byeRank === rank)).toHaveLength(size % 2)
    }
    for (const round of rounds) {
      const ranks = round.matches.flatMap((g) => g.rankPair)
      expect(new Set(ranks).size).toBe(ranks.length)
      expect(ranks).not.toContain(round.byeRank)
    }
  })
  it('preserves standalone limits and circle behavior', () => {
    for (const size of [4, 5, 6]) expect(generateLeagueTeamDuelSchedule(size)).toEqual(generateTeamDuelSchedule(size))
    expect(() => generateTeamDuelSchedule(7)).toThrow()
    for (const size of [3, 8, 4.5]) expect(() => generateLeagueTeamDuelSchedule(size)).toThrow()
  })
})

describe('league duel drafts', () => {
  it('is deterministic, eliminates mirrored duplicates, and sorts rank ties by ID', () => {
    const players = pool(14)
    const options = generateLeagueDuelDrafts(players)
    expect(options).toHaveLength(3)
    expect(generateLeagueDuelDrafts([...players].reverse())).toEqual(options)
    expect(new Set(options.map((o) => o.id)).size).toBe(3)
    for (const draft of options) {
      expect(draft.worstFavorite).toBeCloseTo(0.5)
      expect(draft.squads.flat().map((p) => p.id).sort()).toEqual(players.map((p) => p.id))
      for (const squad of draft.squads) expect(squad.map((p) => p.id)).toEqual(squad.map((p) => p.id).sort())
    }
  })
  it('prioritizes previous played partnerships and counts each previous season once', () => {
    const players = pool(8)
    const first = generateLeagueDuelDrafts(players)[0]!
    const previous = new Set(first.schedule.games.flatMap((game) => [partnershipKey(...game.homePoolPlayerIds), partnershipKey(...game.awayPoolPlayerIds)]))
    const varied = generateLeagueDuelDrafts(players, [previous, previous, previous, new Set(['ignored'])])
    expect(varied[0]!.id).not.toBe(first.id)
    expect(varied[0]!.repeatedPartnerships).toBeLessThan(12)
    expect(varied[0]!.partnerHistoryOccurrences).toBe(varied[0]!.repeatedPartnerships * 3)
    expect(varied[0]!.recentPartnerRepeats).toEqual(Array(3).fill(varied[0]!.repeatedPartnerships))
  })
  it('offers distinct drafts when every partnership is an unavoidable repeat', () => {
    const players = pool(8)
    const allPartners = new Set(players.flatMap((player, i) => players.slice(i + 1).map((other) => partnershipKey(player.id, other.id))))
    const drafts = generateLeagueDuelDrafts(players, [allPartners, allPartners, allPartners])
    expect(drafts).toHaveLength(3)
    expect(new Set(drafts.map((draft) => draft.id)).size).toBe(3)
    for (const draft of drafts) {
      expect(draft.repeatedPartnerships).toBe(12)
      expect(draft.partnerHistoryOccurrences).toBe(36)
      expect(draft.recentPartnerRepeats).toEqual([12, 12, 12])
    }
  })
  it('prefers older repeats when distinct partners and season occurrences tie', () => {
    const players = pool(8)
    const first = generateLeagueDuelDrafts(players)[0]!
    const recent = new Set(first.schedule.games.flatMap((game) => [partnershipKey(...game.homePoolPlayerIds), partnershipKey(...game.awayPoolPlayerIds)]))
    const older = new Set(players.flatMap((player, i) => players.slice(i + 1)
      .map((other) => partnershipKey(player.id, other.id)).filter((pair) => !recent.has(pair))))
    const preferOlder = generateLeagueDuelDrafts(players, [recent, new Set(), older])
    const preferRecent = generateLeagueDuelDrafts(players, [older, new Set(), recent])
    expect(preferOlder[0]!.repeatedPartnerships).toBe(12)
    expect(preferOlder[0]!.partnerHistoryOccurrences).toBe(12)
    expect(preferOlder[0]!.recentPartnerRepeats[0]).toBeLessThan(first.schedule.games.length * 2)
    expect(preferRecent[0]!.id).toBe(first.id)
    expect(preferRecent[0]!.recentPartnerRepeats).toEqual([0, 0, 12])
  })
  it('uses provisional uncertainty and clearly returns fallback imbalance', () => {
    const players = pool(8).map((p, i) => ({ ...p, rating: i === 0 ? 5000 : 800, rating_deviation: 20 }))
    const options = generateLeagueDuelDrafts(players)
    expect(options.every((o) => !o.meetsTarget && o.worstFavorite > 0.65)).toBe(true)
    const uncertain = generateLeagueDuelDrafts(players.map((p, i) => ({ ...p, rating: i === 0 ? 1650 : 1400, rating_deviation: 275 })))
    expect(uncertain[0]!.worstFavorite).toBeLessThan(options[0]!.worstFavorite)
    expect(uncertain[0]!.meetsTarget).toBe(true)
  })
  it('rejects unsupported rosters, duplicates and inactive players', () => {
    for (const count of [6, 9, 16]) expect(() => generateLeagueDuelDrafts(pool(count))).toThrow()
    expect(() => generateLeagueDuelDrafts([...pool(7), pool(1)[0]!])).toThrow()
    expect(() => generateLeagueDuelDrafts(pool(8).map((p, i) => i === 0 ? { ...p, status: 'inactive' } : p))).toThrow()
  })
})

describe('tier-matched schedules', () => {
  for (const size of [4, 5, 6, 7]) it(`preserves tiers, every partnership and rounds for ${size}-player squads`, () => {
    const players = pool(size * 2).map((p, i) => ({ ...p, rating: 2000 - i * 70, rating_deviation: 90 + i * 3 }))
    const draft = generateLeagueDuelDrafts(players)[0]!
    const tiers = assignLeagueDuelTiers(players)
    const games = draft.schedule.games
    expect(games).toHaveLength(size * (size - 1) / 2)
    expect(games.map((game) => game.sequenceNumber)).toEqual(Array.from({ length: games.length }, (_, i) => i + 1))
    for (const squad of draft.squads) {
      expect(['top', 'middle', 'bottom'].map((tier) => squad.filter((p) => tiers.get(p.id) === tier).length)).toEqual(duelTierCounts(size))
      const side = squad === draft.squads[0] ? 'homePoolPlayerIds' : 'awayPoolPlayerIds'
      expect(new Set(games.map((game) => partnershipKey(...game[side]))).size).toBe(games.length)
      for (const player of squad) {
        const appearances = games.filter((game) => game[side].includes(player.id))
        expect(appearances).toHaveLength(size - 1)
        expect(new Set(appearances.flatMap((game) => game[side].filter((id) => id !== player.id))).size).toBe(size - 1)
        expect(new Set(appearances.map((game) => game.roundNumber)).size).toBe(size - 1)
      }
    }
    for (const game of games) expect(game.homePoolPlayerIds.map((id) => tiers.get(id)).sort())
      .toEqual(game.awayPoolPlayerIds.map((id) => tiers.get(id)).sort())
    const rounds = new Set(games.map((game) => game.roundNumber))
    expect(rounds.size).toBe(size - 1 + size % 2)
    for (const round of rounds) {
      const participants = games.filter((game) => game.roundNumber === round).flatMap((game) => [...game.homePoolPlayerIds, ...game.awayPoolPlayerIds])
      expect(participants).toHaveLength(Math.floor(size / 2) * 4)
      expect(new Set(participants).size).toBe(participants.length)
    }
    expect(buildTierMatchedDuelSchedule(draft.squads)).toEqual(draft.schedule)
  })

  it('uses non-mirror tier matches and improves opponent variety for equal ratings', () => {
    const draft = generateLeagueDuelDrafts(pool(14))[0]!
    const rank = (side: number, ids: string[]) => ids.map((id) => draft.squads[side]!.findIndex((p) => p.id === id)).sort().join(':')
    expect(draft.schedule.games.some((game) => rank(0, game.homePoolPlayerIds) !== rank(1, game.awayPoolPlayerIds))).toBe(true)
    expect(draft.opponentRepeats).toBe(73)
  })

  it('rejects unequal tiers and invalid uncertainty', () => {
    const players = pool(14)
    expect(() => buildTierMatchedDuelSchedule([players.slice(0, 7), players.slice(7)])).toThrow(/equal/)
    expect(() => generateLeagueDuelDrafts(players.map((p, i) => i ? p : { ...p, rating_deviation: -1 }))).toThrow()
  })

  it('chooses fresh partners before a better-balanced option', () => {
    const players = pool(8).map((p, i) => ({ ...p, rating: i < 4 ? 1700 : 1300, rating_deviation: 20 }))
    const bestBalanced = generateLeagueDuelDrafts(players)[0]!
    const sideA = [players[0]!, players[2]!, players[3]!, players[6]!]
    const sideB = [players[1]!, players[4]!, players[5]!, players[7]!]
    // Three previous round-robin seasons, with four actual partnerships each.
    const history = [0, 1, 2].map((shift) => new Set(sideA.map((player, index) => partnershipKey(player.id, sideB[(index + shift) % 4]!.id))))
    const fresh = generateLeagueDuelDrafts(players, history)[0]!
    expect(bestBalanced.worstFavorite).toBeCloseTo(0.5)
    expect(fresh.repeatedPartnerships).toBe(0)
    expect(fresh.worstFavorite).toBeGreaterThan(bestBalanced.worstFavorite)
    expect(fresh.meetsTarget).toBe(false)
  })
})

describe('league duel live games and finishes', () => {
  it('uses four actual participants for concurrent courts and queue recommendations', () => {
    const { matches } = fixtures()
    const first = { ...matches[0]!, live_status: 'playing' as const, live_court_number: 1 }
    const independent = matches[1]!
    const overlapping = matches.find((m) => m.id !== first.id && m.home_pool_player_ids!.some((id) => first.home_pool_player_ids!.includes(id)))!
    expect(matchesShareTeam(first, independent)).toBe(false)
    expect(matchesShareTeam(first, overlapping)).toBe(true)
    expect(shouldReleaseQueuedMatch(first, independent, 2)).toBe(false)
    const available = rankAvailableMatches([first, ...matches.slice(1)], [])
    expect(available).toContainEqual(independent)
    expect(available).not.toContainEqual(overlapping)
    const absent = { ...independent, home_team: { ...independent.home_team, players: independent.home_team.players!.map((p, i) => ({ ...p, is_present: i !== 0 })) } }
    expect(areAllMatchPlayersPresent(absent)).toBe(false)
    expect(buildTournamentView([first, absent]).waiting).toEqual([absent])
    expect(rankAvailableMatches([first, absent], [])).toEqual([])
  })
  it('does not complete at an early clinch and shares first place on equal final wins', () => {
    const { teams, matches } = fixtures(4)
    const win = (m: MatchWithTeams, side: string, i: number): MatchWithTeams => ({ ...m, status: 'completed', winner_team_id: side, home_score: side === 'home' ? 11 : 0, away_score: side === 'away' ? 11 : 5, result_recorded_at: `2026-10-01T12:0${i}:00Z` })
    const clinched = matches.map((m, i) => i < 4 ? win(m, 'home', i) : m)
    expect(getLeagueDuelProgress(clinched)).toMatchObject({ complete: false, remaining: 2, clinchedTeamId: 'home' })
    expect(buildTournamentView(clinched).isComplete).toBe(false)
    const tied = matches.map((m, i) => win(m, i % 2 ? 'home' : 'away', i))
    expect(getLeagueDuelProgress(tied)).toMatchObject({ complete: true, tied: true, clinchedTeamId: null })
    expect(computeStandings(teams, tied, 'team_duel').map((r) => [r.rank, r.points])).toEqual([[1, 3], [1, 3]])
  })
})

describe('league duel individual history', () => {
  it('rates exactly four players per game and replays correction, undo, and forfeit canonically', () => {
    const { players, teams, matches } = fixtures()
    const played = matches.map((m, i) => ({ ...m, status: 'completed' as const, winner_team_id: i % 2 ? 'home' : 'away', home_score: i % 2 ? 11 : 6, away_score: i % 2 ? 6 : 11, result_recorded_at: `2026-10-01T12:${String(i).padStart(2, '0')}:00Z` }))
    const replay = (history: typeof played) => replayRatings({ pool: players, finishedMatches: history.map((m) => ({ ...m, season_starts_at: '2026-10-01', home_players: teams[0]!.players, away_players: teams[1]!.players })) as FinishedMatchForRatings[], seasonRosters: new Map([['season', players.map((p) => p.id)]]), recordedAt: '2026-10-02' })
    const full = replay(played)
    expect(full.historyRows).toHaveLength(14 + 21 * 4)
    for (const player of players) expect(full.historyRows.filter((h) => h.pool_player_id === player.id && h.match_id)).toHaveLength(6)
    const correction = played.map((m, i) => i === 2 ? { ...m, winner_team_id: 'home' } : m)
    expect(replay(correction)).toEqual(replay(correction))
    expect(replay(correction).playerRatings).not.toEqual(full.playerRatings)
    const undone = played.slice(1)
    expect(replay(undone).historyRows).toHaveLength(14 + 20 * 4)
    // Forfeits and undone matches are excluded by the shared repository.
    expect(replay(undone)).toEqual(replay(played.filter((m) => m.id !== played[0]!.id)))
    const recap = buildPersonalTournament(players[0]!.id, 'season', played, [])
    expect(recap.played).toBe(6)
    const events = buildPlayerMatchEvents({ poolPlayerId: players[0]!.id, matches: played, nameById: new Map(players.map((p) => [p.id, p.name])) })
    expect(events).toHaveLength(6)
    expect(new Set(events.map((event) => event.partnerPoolId)).size).toBe(6)
  })
})

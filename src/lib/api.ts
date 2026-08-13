import { supabase } from './supabase'
import {
  applyDoublesMatchToRatings,
  applySkipSeasonRdBoost,
  buildRankingRows,
  createInitialRatingsMap,
  TRUESKILL_DEFAULTS,
  type DoublesMatchPlayers,
} from './ratings'
import { buildRoundRobinMatches } from './schedule'
import { validateForfeitTeam, validateMatchResult } from './matchResultValidation'
import { computePlayerFunStats } from './engagement'
import {
  assignPlayerTitles,
  buildTitlePlayerStats,
  type PlayerTitle as AssignedPlayerTitle,
} from './playerTitles'
import { buildPlayerMatchEvents } from './playerMatches'
import { computePlayerRivalries } from './rivalries'
import { computeSeasonRecap, type RatingHistoryRow } from './seasonRecap'
import { computeStandings } from './standings'
import type {
  MatchWithTeams,
  MatchLiveStatus,
  PlayerProfile,
  PlayerRankingRow,
  PlayerTitle,
  PoolPlayer,
  RatingHistoryPoint,
  Season,
  SeasonRecap,
  Team,
  TeamWithPlayers,
} from '../types'

const MATCH_SELECT = `
  *,
  home_team:teams!matches_home_team_id_fkey(id, name, color, players(name, pool_player_id, is_present)),
  away_team:teams!matches_away_team_id_fkey(id, name, color, players(name, pool_player_id, is_present)),
  winner:teams!matches_winner_team_id_fkey(id, name, color)
`

export async function fetchSeasons(): Promise<Season[]> {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .order('starts_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function fetchActiveSeason(): Promise<Season | null> {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .eq('status', 'active')
    .maybeSingle()

  if (error) throw error
  return data
}

export async function createSeason(name: string): Promise<Season> {
  const { data, error } = await supabase
    .from('seasons')
    .insert({ name, status: 'active' })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function archiveSeason(seasonId: string): Promise<Season> {
  const { data, error } = await supabase
    .from('seasons')
    .update({ status: 'archived', ends_at: new Date().toISOString() })
    .eq('id', seasonId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function fetchPlayerRankings(): Promise<PlayerRankingRow[]> {
  const { data, error } = await supabase
    .from('player_pool')
    .select('id, name, status, rating, rating_deviation, volatility')
    .order('rating', { ascending: false })

  if (error) throw error
  const rows = buildRankingRows(data ?? [])
  const titles = await fetchPlayerTitlesMap()
  return rows.map((row) => ({
    ...row,
    title: titles.get(row.id) ?? null,
  }))
}

function toPublicTitle(title: AssignedPlayerTitle | undefined): PlayerTitle | null {
  if (!title) return null
  return { id: title.id, whyParams: title.whyParams }
}

export async function fetchPlayerTitlesMap(): Promise<Map<string, PlayerTitle>> {
  const { data: pool, error: poolError } = await supabase
    .from('player_pool')
    .select('id, name, rating, rating_deviation, initial_rating')
  if (poolError) throw poolError

  const poolRows = pool ?? []
  if (poolRows.length === 0) return new Map()

  const ratingById = new Map(
    poolRows.map((row) => [
      row.id,
      { rating: row.rating as number, rd: row.rating_deviation as number },
    ]),
  )
  const nameById = new Map(poolRows.map((row) => [row.id, row.name as string]))

  const { data: historyRows, error: historyError } = await supabase
    .from('rating_history')
    .select('id, pool_player_id, match_id, rating, rating_deviation, recorded_at, sequence')
    .order('sequence')
  if (historyError) throw historyError

  const { data: matches, error: matchError } = await supabase
    .from('matches')
    .select(
      'id, season_id, status, winner_team_id, home_team_id, away_team_id, home_score, away_score, home_pool_player_ids, away_pool_player_ids, result_recorded_at',
    )
  if (matchError) throw matchError

  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('id, season_id, name, color, created_at, players(id, name, pool_player_id, team_id, created_at)')
  if (teamsError) throw teamsError

  const { data: seasons, error: seasonsError } = await supabase
    .from('seasons')
    .select('id, status')
  if (seasonsError) throw seasonsError

  const teamsBySeason = new Map<string, TeamWithPlayers[]>()
  for (const team of teams ?? []) {
    const list = teamsBySeason.get(team.season_id) ?? []
    list.push({
      ...team,
      players: [...(team.players ?? [])].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      ),
    } as TeamWithPlayers)
    teamsBySeason.set(team.season_id, list)
  }

  const matchesBySeason = new Map<string, MatchWithTeams[]>()
  for (const match of matches ?? []) {
    const list = matchesBySeason.get(match.season_id) ?? []
    list.push(match as MatchWithTeams)
    matchesBySeason.set(match.season_id, list)
  }

  const seasonFinishes: {
    seasonId: string
    ranks: Map<string, number>
  }[] = []

  for (const season of seasons ?? []) {
    const seasonTeams = teamsBySeason.get(season.id) ?? []
    const seasonMatches = matchesBySeason.get(season.id) ?? []
    const finished = seasonMatches.filter(
      (m) => m.status === 'completed' || m.status === 'forfeit',
    )
    if (seasonTeams.length === 0 || finished.length === 0) continue
    // Prefer archived seasons; allow active if most fixtures are done
    const totalFixtures = seasonMatches.length
    const doneRatio = totalFixtures > 0 ? finished.length / totalFixtures : 0
    if (season.status !== 'archived' && doneRatio < 0.8) continue

    const standings = computeStandings(seasonTeams, finished)
    const ranks = new Map<string, number>()
    for (const row of standings) {
      for (const player of row.players) {
        ranks.set(player.poolPlayerId, row.rank)
      }
    }
    seasonFinishes.push({ seasonId: season.id, ranks })
  }

  const completedMatches = (matches ?? []).filter((m) => m.status === 'completed')

  const matchForTitles = completedMatches.map((match) => {
    const homeIds = (match.home_pool_player_ids ?? []) as string[]
    const awayIds = (match.away_pool_player_ids ?? []) as string[]
    const resolvePlayers = (ids: string[]) =>
      ids.map((id) => {
        const skill = ratingById.get(id)
        return {
          id,
          name: nameById.get(id) ?? '?',
          rating: skill?.rating ?? 1500,
          rd: skill?.rd ?? 350,
        }
      })

    // Fallback to roster if snapshot missing
    let homePlayers = resolvePlayers(homeIds)
    let awayPlayers = resolvePlayers(awayIds)
    if (homePlayers.length === 0 || awayPlayers.length === 0) {
      const homeTeam = (teams ?? []).find((t) => t.id === match.home_team_id)
      const awayTeam = (teams ?? []).find((t) => t.id === match.away_team_id)
      if (homePlayers.length === 0 && homeTeam?.players) {
        homePlayers = resolvePlayers(homeTeam.players.map((p) => p.pool_player_id))
      }
      if (awayPlayers.length === 0 && awayTeam?.players) {
        awayPlayers = resolvePlayers(awayTeam.players.map((p) => p.pool_player_id))
      }
    }

    return {
      id: match.id,
      winner_team_id: match.winner_team_id,
      home_team_id: match.home_team_id,
      away_team_id: match.away_team_id,
      home_score: match.home_score,
      away_score: match.away_score,
      home_pool_player_ids: match.home_pool_player_ids,
      away_pool_player_ids: match.away_pool_player_ids,
      homePlayers,
      awayPlayers,
    }
  })

  const resultByMatchPlayer = new Map<string, 'W' | 'L'>()
  const partnerByMatchPlayer = new Map<string, string>()
  const opponentsByMatchPlayer = new Map<string, string[]>()

  for (const match of matchForTitles) {
    if (!match.winner_team_id) continue
    const homeIds = match.homePlayers.map((p) => p.id)
    const awayIds = match.awayPlayers.map((p) => p.id)
    const homeWon = match.winner_team_id === match.home_team_id

    for (const id of homeIds) {
      const key = `${match.id}:${id}`
      resultByMatchPlayer.set(key, homeWon ? 'W' : 'L')
      partnerByMatchPlayer.set(
        key,
        homeIds.filter((x) => x !== id).map((x) => nameById.get(x) ?? '?')[0] ?? '?',
      )
      opponentsByMatchPlayer.set(
        key,
        awayIds.map((x) => nameById.get(x) ?? '?'),
      )
    }
    for (const id of awayIds) {
      const key = `${match.id}:${id}`
      resultByMatchPlayer.set(key, homeWon ? 'L' : 'W')
      partnerByMatchPlayer.set(
        key,
        awayIds.filter((x) => x !== id).map((x) => nameById.get(x) ?? '?')[0] ?? '?',
      )
      opponentsByMatchPlayer.set(
        key,
        homeIds.map((x) => nameById.get(x) ?? '?'),
      )
    }
  }

  const historyByPlayer = new Map<string, RatingHistoryPoint[]>()
  for (const row of historyRows ?? []) {
    const list = historyByPlayer.get(row.pool_player_id) ?? []
    const key = row.match_id ? `${row.match_id}:${row.pool_player_id}` : null
    list.push({
      id: row.id,
      matchId: row.match_id,
      rating: row.rating,
      ratingDeviation: row.rating_deviation,
      recordedAt: row.recorded_at,
      sequence: row.sequence,
      roundNumber: null,
      seasonId: null,
      seasonName: null,
      seasonStartsAt: null,
      resultRecordedAt: null,
      result: key ? resultByMatchPlayer.get(key) ?? null : null,
      partnerName: key ? partnerByMatchPlayer.get(key) ?? null : null,
      opponentNames: key ? opponentsByMatchPlayer.get(key) ?? [] : [],
      scoreLabel: null,
    })
    historyByPlayer.set(row.pool_player_id, list)
  }

  const stats = poolRows.map((player) =>
    buildTitlePlayerStats({
      id: player.id,
      name: player.name,
      rating: player.rating,
      initialRating: player.initial_rating,
      history: historyByPlayer.get(player.id) ?? [],
      matches: matchForTitles,
      seasonFinishes,
    }),
  )

  const assigned = assignPlayerTitles(stats)
  const publicMap = new Map<string, PlayerTitle>()
  for (const [id, title] of assigned) {
    publicMap.set(id, toPublicTitle(title)!)
  }
  return publicMap
}

export async function fetchPlayerProfile(poolPlayerId: string): Promise<PlayerProfile> {
  const { data: player, error: playerError } = await supabase
    .from('player_pool')
    .select('*')
    .eq('id', poolPlayerId)
    .single()
  if (playerError) throw playerError

  const rankings = await fetchPlayerRankings()
  const rank = rankings.find((row) => row.id === poolPlayerId)?.rank ?? rankings.length + 1
  const title = rankings.find((row) => row.id === poolPlayerId)?.title ?? null

  const { data: historyRows, error: historyError } = await supabase
    .from('rating_history')
    .select('id, match_id, rating, rating_deviation, recorded_at, sequence')
    .eq('pool_player_id', poolPlayerId)
    .order('sequence')
  if (historyError) throw historyError

  const { data: poolNames, error: poolNamesError } = await supabase
    .from('player_pool')
    .select('id, name')
  if (poolNamesError) throw poolNamesError
  const nameById = new Map((poolNames ?? []).map((row) => [row.id, row.name]))

  const { data: resultMatches, error: resultError } = await supabase
    .from('matches')
    .select(
      'id, season_id, round_number, winner_team_id, home_team_id, away_team_id, home_score, away_score, home_pool_player_ids, away_pool_player_ids, result_recorded_at, seasons(name, starts_at)',
    )
    .eq('status', 'completed')
    .order('result_recorded_at')
  if (resultError) throw resultError

  const teamIds = [
    ...new Set(
      (resultMatches ?? []).flatMap((match) => [
        match.home_team_id,
        match.away_team_id,
      ]),
    ),
  ]
  const rosterByTeam = new Map<
    string,
    { name: string; pool_player_id: string }[]
  >()
  if (teamIds.length > 0) {
    const { data: rosterRows, error: rosterError } = await supabase
      .from('players')
      .select('team_id, name, pool_player_id')
      .in('team_id', teamIds)
    if (rosterError) throw rosterError
    for (const row of rosterRows ?? []) {
      const list = rosterByTeam.get(row.team_id) ?? []
      list.push({ name: row.name, pool_player_id: row.pool_player_id })
      rosterByTeam.set(row.team_id, list)
    }
  }

  const resolveIds = (match: {
    home_team_id: string
    away_team_id: string
    home_pool_player_ids: string[] | null
    away_pool_player_ids: string[] | null
  }) => {
    const homeFromSnap = match.home_pool_player_ids ?? []
    const awayFromSnap = match.away_pool_player_ids ?? []
    return {
      homeIds:
        homeFromSnap.length > 0
          ? homeFromSnap
          : (rosterByTeam.get(match.home_team_id) ?? []).map(
              (player) => player.pool_player_id,
            ),
      awayIds:
        awayFromSnap.length > 0
          ? awayFromSnap
          : (rosterByTeam.get(match.away_team_id) ?? []).map(
              (player) => player.pool_player_id,
            ),
    }
  }

  const playerMatches = (resultMatches ?? [])
    .filter((match) => {
      const { homeIds, awayIds } = resolveIds(match)
      return homeIds.includes(poolPlayerId) || awayIds.includes(poolPlayerId)
    })
    .slice()
    .sort((a, b) => {
      const seasonA = Array.isArray(a.seasons) ? a.seasons[0] : a.seasons
      const seasonB = Array.isArray(b.seasons) ? b.seasons[0] : b.seasons
      const startsA = (seasonA as { starts_at?: string } | null)?.starts_at ?? ''
      const startsB = (seasonB as { starts_at?: string } | null)?.starts_at ?? ''
      const seasonDiff = startsA.localeCompare(startsB)
      if (seasonDiff !== 0) return seasonDiff
      const recordedA = a.result_recorded_at ?? ''
      const recordedB = b.result_recorded_at ?? ''
      const recordedDiff = recordedA.localeCompare(recordedB)
      if (recordedDiff !== 0) return recordedDiff
      return a.id.localeCompare(b.id)
    })

  let wins = 0
  let losses = 0
  const form: ('W' | 'L')[] = []
  const resultByMatchId = new Map<string, 'W' | 'L'>()
  const partnerByMatchId = new Map<string, string>()
  const opponentsByMatchId = new Map<string, string[]>()
  const matchMeta = new Map<
    string,
    {
      roundNumber: number
      scoreLabel: string | null
      seasonId: string
      seasonName: string | null
      seasonStartsAt: string | null
      resultRecordedAt: string | null
    }
  >()

  for (const match of playerMatches) {
    const { homeIds, awayIds } = resolveIds(match)
    const onHome = homeIds.includes(poolPlayerId)
    const won =
      (onHome && match.winner_team_id === match.home_team_id) ||
      (!onHome && match.winner_team_id === match.away_team_id)

    if (won) wins += 1
    else losses += 1
    form.push(won ? 'W' : 'L')
    resultByMatchId.set(match.id, won ? 'W' : 'L')

    const teammates = (onHome ? homeIds : awayIds).filter(
      (id: string) => id !== poolPlayerId,
    )
    const foeIds = onHome ? awayIds : homeIds
    partnerByMatchId.set(
      match.id,
      teammates[0] ? (nameById.get(teammates[0]) ?? '?') : '?',
    )
    opponentsByMatchId.set(
      match.id,
      foeIds.map((id: string) => nameById.get(id) ?? '?'),
    )
    const seasonJoin = match.seasons as
      | { name: string; starts_at: string }
      | { name: string; starts_at: string }[]
      | null
    const season = Array.isArray(seasonJoin) ? seasonJoin[0] : seasonJoin
    matchMeta.set(match.id, {
      roundNumber: match.round_number,
      scoreLabel:
        match.home_score != null && match.away_score != null
          ? `${match.home_score}-${match.away_score}`
          : null,
      seasonId: match.season_id,
      seasonName: season?.name ?? null,
      seasonStartsAt: season?.starts_at ?? null,
      resultRecordedAt: match.result_recorded_at,
    })
  }

  const history: RatingHistoryPoint[] = (historyRows ?? []).map((row) => {
    const meta = row.match_id ? matchMeta.get(row.match_id) : undefined
    return {
      id: row.id,
      matchId: row.match_id,
      rating: row.rating,
      ratingDeviation: row.rating_deviation,
      recordedAt: row.recorded_at,
      sequence: row.sequence,
      roundNumber: meta?.roundNumber ?? null,
      seasonId: meta?.seasonId ?? null,
      seasonName: meta?.seasonName ?? null,
      seasonStartsAt: meta?.seasonStartsAt ?? null,
      resultRecordedAt: meta?.resultRecordedAt ?? null,
      result: row.match_id ? resultByMatchId.get(row.match_id) ?? null : null,
      partnerName: row.match_id ? partnerByMatchId.get(row.match_id) ?? null : null,
      opponentNames: row.match_id ? opponentsByMatchId.get(row.match_id) ?? [] : [],
      scoreLabel: meta?.scoreLabel ?? null,
    }
  })

  const played = wins + losses
  const startRating = history[0]?.rating ?? player.initial_rating

  // Rivalries: use MatchWithTeams-shaped rows with snapshot or roster fallback
  const rivalryMatches = (resultMatches ?? []).map((match) => {
    const seasonJoin = match.seasons as
      | { name: string; starts_at: string }
      | { name: string; starts_at: string }[]
      | null
    const season = Array.isArray(seasonJoin) ? seasonJoin[0] : seasonJoin
    const homeSnap = match.home_pool_player_ids ?? []
    const awaySnap = match.away_pool_player_ids ?? []
    const homePlayers =
      homeSnap.length > 0
        ? homeSnap.map((id: string) => ({
            name: nameById.get(id) ?? '?',
            pool_player_id: id,
          }))
        : (rosterByTeam.get(match.home_team_id) ?? [])
    const awayPlayers =
      awaySnap.length > 0
        ? awaySnap.map((id: string) => ({
            name: nameById.get(id) ?? '?',
            pool_player_id: id,
          }))
        : (rosterByTeam.get(match.away_team_id) ?? [])
    return {
      ...match,
      status: 'completed' as const,
      live_status: 'available' as const,
      live_court_number: null,
      round_number: match.round_number,
      created_at: '',
      home_team: {
        id: match.home_team_id,
        name: '',
        color: '',
        players: homePlayers,
      },
      away_team: {
        id: match.away_team_id,
        name: '',
        color: '',
        players: awayPlayers,
      },
      winner: null,
      seasons: season,
    } as MatchWithTeams
  })

  const seasonNameById = new Map<string, string>()
  for (const match of resultMatches ?? []) {
    const seasonJoin = match.seasons as
      | { name: string }
      | { name: string }[]
      | null
    const season = Array.isArray(seasonJoin) ? seasonJoin[0] : seasonJoin
    if (season?.name) seasonNameById.set(match.season_id, season.name)
  }

  const rivalryEvents = buildPlayerMatchEvents({
    poolPlayerId,
    matches: rivalryMatches,
    nameById,
    seasonNameById,
  })
  const rivalries = computePlayerRivalries({
    events: rivalryEvents,
    nameById,
  })

  return {
    id: player.id,
    name: player.name,
    rating: player.rating,
    ratingDeviation: player.rating_deviation,
    initialRating: player.initial_rating,
    rank,
    played,
    wins,
    losses,
    winRate: played > 0 ? wins / played : 0,
    form: form.slice(-5),
    ratingDelta: player.rating - startRating,
    history,
    funStats: computePlayerFunStats(history),
    title,
    rivalries,
  }
}

interface FinishedMatchForRatings {
  id: string
  season_id: string
  round_number: number
  season_starts_at: string
  result_recorded_at: string | null
  winner_team_id: string
  home_team_id: string
  away_team_id: string
  home_score: number | null
  away_score: number | null
  home_pool_player_ids: string[] | null
  away_pool_player_ids: string[] | null
  home_players: { pool_player_id: string }[]
  away_players: { pool_player_id: string }[]
}

interface PendingRatingMatch {
  matchId: string
  mode: 'completed' | 'exclude'
  winnerTeamId?: string
  homeScore?: number | null
  awayScore?: number | null
  homePoolPlayerIds?: string[]
  awayPoolPlayerIds?: string[]
  resultRecordedAt?: string | null
}

async function fetchCompletedMatchesForRatings(
  pending?: PendingRatingMatch,
): Promise<FinishedMatchForRatings[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      id,
      status,
      season_id,
      round_number,
      result_recorded_at,
      winner_team_id,
      home_team_id,
      away_team_id,
      home_score,
      away_score,
      home_pool_player_ids,
      away_pool_player_ids,
      seasons(starts_at),
      home_team:teams!matches_home_team_id_fkey(
        players(pool_player_id)
      ),
      away_team:teams!matches_away_team_id_fkey(
        players(pool_player_id)
      )
    `)

  if (error) throw error

  const relevantRows = (data ?? []).filter((row) => {
    if (pending && row.id === pending.matchId) return pending.mode === 'completed'
    return row.status === 'completed'
  })

  const rows = relevantRows.map((row) => {
    const homeTeam = Array.isArray(row.home_team) ? row.home_team[0] : row.home_team
    const awayTeam = Array.isArray(row.away_team) ? row.away_team[0] : row.away_team
    const seasonJoin = row.seasons as
      | { starts_at: string }
      | { starts_at: string }[]
      | null
    const season = Array.isArray(seasonJoin) ? seasonJoin[0] : seasonJoin

    const pendingMatch =
      pending && row.id === pending.matchId && pending.mode === 'completed'
        ? pending
        : null
    return {
      id: row.id,
      season_id: row.season_id,
      round_number: row.round_number,
      season_starts_at: season?.starts_at ?? '',
      result_recorded_at: pendingMatch
        ? (pendingMatch.resultRecordedAt ?? row.result_recorded_at)
        : row.result_recorded_at,
      winner_team_id: pendingMatch ? pendingMatch.winnerTeamId! : row.winner_team_id!,
      home_team_id: row.home_team_id,
      away_team_id: row.away_team_id,
      home_score: pendingMatch ? (pendingMatch.homeScore ?? null) : row.home_score,
      away_score: pendingMatch ? (pendingMatch.awayScore ?? null) : row.away_score,
      home_pool_player_ids: pendingMatch
        ? (pendingMatch.homePoolPlayerIds ?? null)
        : row.home_pool_player_ids,
      away_pool_player_ids: pendingMatch
        ? (pendingMatch.awayPoolPlayerIds ?? null)
        : row.away_pool_player_ids,
      home_players: homeTeam?.players ?? [],
      away_players: awayTeam?.players ?? [],
    }
  })

  rows.sort((a, b) => {
    const seasonDiff = a.season_starts_at.localeCompare(b.season_starts_at)
    if (seasonDiff !== 0) return seasonDiff
    const recordedA = a.result_recorded_at ?? ''
    const recordedB = b.result_recorded_at ?? ''
    const recordedDiff = recordedA.localeCompare(recordedB)
    if (recordedDiff !== 0) return recordedDiff
    return a.id.localeCompare(b.id)
  })

  return rows
}

function poolIdsFromSnapshotOrRoster(
  snapshot: string[] | null | undefined,
  roster: { pool_player_id: string }[],
): [string, string] | null {
  const ids =
    snapshot && snapshot.length === 2
      ? snapshot
      : roster.map((player) => player.pool_player_id)

  if (ids.length !== 2) return null
  return [ids[0], ids[1]]
}

function toDoublesMatchPlayers(match: FinishedMatchForRatings): DoublesMatchPlayers | null {
  const homeIds = poolIdsFromSnapshotOrRoster(
    match.home_pool_player_ids,
    match.home_players,
  )
  const awayIds = poolIdsFromSnapshotOrRoster(
    match.away_pool_player_ids,
    match.away_players,
  )
  if (!homeIds || !awayIds) return null

  if (match.winner_team_id === match.home_team_id) {
    return {
      winnerPoolIds: homeIds,
      loserPoolIds: awayIds,
      winnerScore: match.home_score,
      loserScore: match.away_score,
      matchId: match.id,
    }
  }
  if (match.winner_team_id === match.away_team_id) {
    return {
      winnerPoolIds: awayIds,
      loserPoolIds: homeIds,
      winnerScore: match.away_score,
      loserScore: match.home_score,
      matchId: match.id,
    }
  }

  return null
}

async function fetchTeamPoolPlayerIds(
  homeTeamId: string,
  awayTeamId: string,
): Promise<{ homeIds: string[]; awayIds: string[] }> {
  const { data, error } = await supabase
    .from('players')
    .select('team_id, pool_player_id')
    .in('team_id', [homeTeamId, awayTeamId])
    .order('id')

  if (error) throw error

  const homeIds = (data ?? [])
    .filter((row) => row.team_id === homeTeamId)
    .map((row) => row.pool_player_id)
  const awayIds = (data ?? [])
    .filter((row) => row.team_id === awayTeamId)
    .map((row) => row.pool_player_id)

  return { homeIds, awayIds }
}

async function fetchSeasonPoolPlayerIds(seasonId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('players')
    .select('pool_player_id, teams!inner(season_id)')
    .eq('teams.season_id', seasonId)

  if (error) throw error

  return [...new Set((data ?? []).map((row) => row.pool_player_id))]
}

async function buildRatingsReplacement(pending?: PendingRatingMatch) {
  const { data: pool, error: poolError } = await supabase
    .from('player_pool')
    .select('id, initial_rating')
  if (poolError) throw poolError

  const poolRows = pool ?? []
  const ratings = createInitialRatingsMap(poolRows)
  const finishedMatches = await fetchCompletedMatchesForRatings(pending)
  const seasonRosterCache = new Map<string, string[]>()

  const historyRows: {
    pool_player_id: string
    match_id: string | null
    rating: number
    rating_deviation: number
    sequence: number
    recorded_at: string
  }[] = []

  let sequence = 0
  const now = new Date().toISOString()
  const hasPlayed = new Set<string>()

  for (const row of poolRows) {
    const initial = ratings.get(row.id)!
    historyRows.push({
      pool_player_id: row.id,
      match_id: null,
      rating: initial.rating,
      rating_deviation: initial.rd,
      sequence: sequence++,
      recorded_at: now,
    })
  }

  let previousSeasonId: string | null = null

  for (const match of finishedMatches) {
    if (previousSeasonId && match.season_id !== previousSeasonId) {
      let seasonPoolIds = seasonRosterCache.get(match.season_id)
      if (!seasonPoolIds) {
        seasonPoolIds = await fetchSeasonPoolPlayerIds(match.season_id)
        seasonRosterCache.set(match.season_id, seasonPoolIds)
      }
      const onRoster = new Set(seasonPoolIds)
      const skippers = [...hasPlayed].filter((id) => !onRoster.has(id))
      const boosted = applySkipSeasonRdBoost(ratings, skippers)
      const skipRecordedAt = match.season_starts_at || now
      for (const playerId of boosted) {
        const skill = ratings.get(playerId)
        if (!skill) continue
        historyRows.push({
          pool_player_id: playerId,
          match_id: null,
          rating: skill.rating,
          rating_deviation: skill.rd,
          sequence: sequence++,
          recorded_at: skipRecordedAt,
        })
      }
    }

    let seasonPoolIds = seasonRosterCache.get(match.season_id)
    if (!seasonPoolIds) {
      seasonPoolIds = await fetchSeasonPoolPlayerIds(match.season_id)
      seasonRosterCache.set(match.season_id, seasonPoolIds)
    }

    const doubles = toDoublesMatchPlayers(match)
    if (!doubles) {
      previousSeasonId = match.season_id
      continue
    }

    applyDoublesMatchToRatings(ratings, doubles)

    const recordedAt = match.result_recorded_at ?? now
    for (const playerId of [...doubles.winnerPoolIds, ...doubles.loserPoolIds]) {
      hasPlayed.add(playerId)
      const skill = ratings.get(playerId)
      if (!skill) continue
      historyRows.push({
        pool_player_id: playerId,
        match_id: match.id,
        rating: skill.rating,
        rating_deviation: skill.rd,
        sequence: sequence++,
        recorded_at: recordedAt,
      })
    }

    previousSeasonId = match.season_id
  }

  const playerRatings = poolRows.map((row) => {
    const current = ratings.get(row.id) ?? {
      rating: row.initial_rating,
      rd: TRUESKILL_DEFAULTS.rd,
      volatility: TRUESKILL_DEFAULTS.volatility,
    }
    return {
      id: row.id,
      rating: current.rating,
      rating_deviation: current.rd,
      volatility: current.volatility,
    }
  })

  return { historyRows, playerRatings }
}

export async function recomputeAllRatings(): Promise<void> {
  const { historyRows, playerRatings } = await buildRatingsReplacement()
  const { error } = await supabase.rpc('replace_ratings_atomic', {
    p_history_rows: historyRows,
    p_player_ratings: playerRatings,
  })
  if (error) throw error
}

export async function fetchPlayerPool(): Promise<PoolPlayer[]> {
  const { data, error } = await supabase
    .from('player_pool')
    .select('*')
    .order('name')

  if (error) throw error
  return data ?? []
}

export async function createPoolPlayer(
  name: string,
  initialRating: number = TRUESKILL_DEFAULTS.rating,
): Promise<PoolPlayer> {
  const rating = Math.round(
    Math.min(2500, Math.max(800, Number.isFinite(initialRating) ? initialRating : 1500)),
  )

  const { data, error } = await supabase
    .from('player_pool')
    .insert({
      name: name.trim(),
      status: 'active',
      rating,
      initial_rating: rating,
      rating_deviation: TRUESKILL_DEFAULTS.rd,
      volatility: TRUESKILL_DEFAULTS.volatility,
    })
    .select()
    .single()

  if (error) throw error

  const { data: maxSeqRows, error: seqError } = await supabase
    .from('rating_history')
    .select('sequence')
    .order('sequence', { ascending: false })
    .limit(1)
  if (seqError) throw seqError

  const nextSequence = ((maxSeqRows?.[0]?.sequence as number | undefined) ?? -1) + 1
  const { error: historyError } = await supabase.from('rating_history').insert({
    pool_player_id: data.id,
    match_id: null,
    rating,
    rating_deviation: TRUESKILL_DEFAULTS.rd,
    sequence: nextSequence,
    recorded_at: new Date().toISOString(),
  })
  if (historyError) throw historyError

  return data
}

export async function updatePoolPlayer(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('player_pool')
    .update({ name: name.trim() })
    .eq('id', id)

  if (error) throw error
}

export async function updatePoolPlayerStatus(
  id: string,
  status: 'active' | 'inactive',
): Promise<void> {
  if (status === 'inactive') {
    const { data: activeSeasons, error: seasonError } = await supabase
      .from('seasons')
      .select('id')
      .eq('status', 'active')
    if (seasonError) throw seasonError

    const activeSeasonIds = (activeSeasons ?? []).map((season) => season.id)
    if (activeSeasonIds.length > 0) {
      const { data: assignedRows, error: assignedError } = await supabase
        .from('players')
        .select('id, teams!inner(season_id)')
        .eq('pool_player_id', id)
        .in('teams.season_id', activeSeasonIds)

      if (assignedError) throw assignedError
      if ((assignedRows ?? []).length > 0) {
        throw new Error(
          'Player is on a team in the current season and cannot be set inactive',
        )
      }
    }
  }

  const { error } = await supabase
    .from('player_pool')
    .update({ status })
    .eq('id', id)

  if (error) throw error
}

export async function deletePoolPlayer(id: string): Promise<void> {
  const { count, error: countError } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('pool_player_id', id)

  if (countError) throw countError
  if ((count ?? 0) > 0) {
    throw new Error('Player is assigned to a team and cannot be deleted')
  }

  const { error } = await supabase.from('player_pool').delete().eq('id', id)
  if (error) throw error
}

export async function fetchAssignedPoolPlayerIds(seasonId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('players')
    .select('pool_player_id, teams!inner(season_id)')
    .eq('teams.season_id', seasonId)

  if (error) throw error
  return (data ?? []).map((row) => row.pool_player_id)
}

async function loadPoolPlayersByIds(ids: string[]): Promise<Map<string, PoolPlayer>> {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('player_pool')
    .select('*')
    .in('id', uniqueIds)

  if (error) throw error

  return new Map((data ?? []).map((player) => [player.id, player]))
}

async function assertPoolPlayersAvailable(
  seasonId: string,
  poolPlayerIds: string[],
  excludeTeamId?: string,
): Promise<Map<string, PoolPlayer>> {
  if (poolPlayerIds.length !== 2) {
    throw new Error('A team must have exactly 2 players')
  }

  if (new Set(poolPlayerIds).size !== poolPlayerIds.length) {
    throw new Error('Team players must be different people')
  }

  const poolById = await loadPoolPlayersByIds(poolPlayerIds)
  for (const id of poolPlayerIds) {
    const player = poolById.get(id)
    if (!player) {
      throw new Error('One or more selected players were not found in the pool')
    }
    if (player.status !== 'active') {
      throw new Error('Only active players can be assigned to teams')
    }
  }

  const { data: assignedRows, error } = await supabase
    .from('players')
    .select('pool_player_id, team_id, teams!inner(season_id)')
    .eq('teams.season_id', seasonId)
    .in('pool_player_id', poolPlayerIds)

  if (error) throw error

  for (const row of assignedRows ?? []) {
    if (excludeTeamId && row.team_id === excludeTeamId) continue
    throw new Error('One or more selected players are already on another team this season')
  }

  return poolById
}

export async function fetchTeams(seasonId: string): Promise<Team[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('season_id', seasonId)
    .order('created_at')

  if (error) throw error
  return data ?? []
}

export async function fetchTeamsWithPlayers(seasonId: string): Promise<TeamWithPlayers[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('*, players(*)')
    .eq('season_id', seasonId)
    .order('created_at')

  if (error) throw error

  return (data ?? []).map((team) => ({
    ...team,
    players: [...(team.players ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }))
}

export async function fetchMatches(seasonId: string): Promise<MatchWithTeams[]> {
  const [matchesResult, ratingsResult] = await Promise.all([
    supabase
      .from('matches')
      .select(MATCH_SELECT)
      .eq('season_id', seasonId)
      .order('result_recorded_at', { ascending: false, nullsFirst: true })
      .order('id'),
    supabase.from('player_pool').select('id, rating, rating_deviation'),
  ])

  if (matchesResult.error) throw matchesResult.error
  if (ratingsResult.error) throw ratingsResult.error

  const ratings = new Map(
    (ratingsResult.data ?? []).map((player) => [
      player.id,
      { rating: player.rating, ratingDeviation: player.rating_deviation },
    ]),
  )
  const matches = (matchesResult.data ?? []) as MatchWithTeams[]

  return matches.map((match) => ({
    ...match,
    home_team: {
      ...match.home_team,
      players: match.home_team.players?.map((player) => ({
        ...player,
        rating: ratings.get(player.pool_player_id)?.rating,
        ratingDeviation: ratings.get(player.pool_player_id)?.ratingDeviation,
      })),
    },
    away_team: {
      ...match.away_team,
      players: match.away_team.players?.map((player) => ({
        ...player,
        rating: ratings.get(player.pool_player_id)?.rating,
        ratingDeviation: ratings.get(player.pool_player_id)?.ratingDeviation,
      })),
    },
  }))
}

export async function fetchSeasonRecap(seasonId: string): Promise<SeasonRecap> {
  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .select('*')
    .eq('id', seasonId)
    .single()
  if (seasonError) throw seasonError

  const [teams, matches, poolNames, historyResult] = await Promise.all([
    fetchTeamsWithPlayers(seasonId),
    fetchMatches(seasonId),
    supabase.from('player_pool').select('id, name'),
    supabase
      .from('rating_history')
      .select('pool_player_id, match_id, rating, rating_deviation, sequence')
      .order('sequence'),
  ])

  if (poolNames.error) throw poolNames.error
  if (historyResult.error) throw historyResult.error

  const nameById = new Map((poolNames.data ?? []).map((row) => [row.id, row.name]))

  // Filter history to this season's matches + initial rows (match_id null)
  const seasonMatchIds = new Set(matches.map((match) => match.id))
  const ratingHistory: RatingHistoryRow[] = (historyResult.data ?? []).filter(
    (row) => row.match_id == null || seasonMatchIds.has(row.match_id),
  )

  // Also include history rows that precede season matches for the same players
  // (needed for pre-match start ratings). Fetch any missing prior rows per player.
  const rosterIds = new Set(
    teams.flatMap((team) => team.players.map((player) => player.pool_player_id)),
  )
  const { data: fullHistory, error: fullHistoryError } = await supabase
    .from('rating_history')
    .select('pool_player_id, match_id, rating, rating_deviation, sequence')
    .in('pool_player_id', [...rosterIds])
    .order('sequence')
  if (fullHistoryError) throw fullHistoryError

  return computeSeasonRecap({
    season,
    teams,
    matches,
    ratingHistory: (fullHistory ?? ratingHistory) as RatingHistoryRow[],
    nameById,
  })
}

export async function createSeasonMatches(seasonId: string): Promise<number> {
  const teams = await fetchTeams(seasonId)
  if (teams.length < 2) {
    throw new Error('Need at least 2 teams to create matches')
  }

  const rows = buildRoundRobinMatches(
    seasonId,
    teams.map((team) => team.id),
  )

  const { data, error } = await supabase.rpc('create_season_matches_atomic', {
    p_season_id: seasonId,
    p_matches: rows.map((row) => ({
      home_team_id: row.home_team_id,
      away_team_id: row.away_team_id,
      round_number: row.round_number,
    })),
  })
  if (error) throw error
  return data as number
}

export async function recordResult(
  matchId: string,
  payload: {
    winnerTeamId: string
    homeScore?: number
    awayScore?: number
  },
): Promise<void> {
  const { data: match, error: matchError } = await supabase
    .from('matches')
    .select(
      'home_team_id, away_team_id, home_pool_player_ids, away_pool_player_ids, result_recorded_at',
    )
    .eq('id', matchId)
    .single()
  if (matchError) throw matchError

  validateMatchResult({
    homeTeamId: match.home_team_id,
    awayTeamId: match.away_team_id,
    winnerTeamId: payload.winnerTeamId,
    homeScore: payload.homeScore,
    awayScore: payload.awayScore,
  })

  let homeIds = match.home_pool_player_ids ?? []
  let awayIds = match.away_pool_player_ids ?? []
  if (homeIds.length !== 2 || awayIds.length !== 2) {
    const current = await fetchTeamPoolPlayerIds(match.home_team_id, match.away_team_id)
    if (homeIds.length !== 2) homeIds = current.homeIds
    if (awayIds.length !== 2) awayIds = current.awayIds
  }

  const resultRecordedAt = match.result_recorded_at ?? new Date().toISOString()
  const { historyRows, playerRatings } = await buildRatingsReplacement({
    matchId,
    mode: 'completed',
    winnerTeamId: payload.winnerTeamId,
    homeScore: payload.homeScore ?? null,
    awayScore: payload.awayScore ?? null,
    homePoolPlayerIds: homeIds,
    awayPoolPlayerIds: awayIds,
    resultRecordedAt,
  })

  const { error } = await supabase.rpc('save_match_and_ratings_atomic', {
    p_match_id: matchId,
    p_status: 'completed',
    p_winner_team_id: payload.winnerTeamId,
    p_home_score: payload.homeScore ?? null,
    p_away_score: payload.awayScore ?? null,
    p_home_pool_player_ids: homeIds,
    p_away_pool_player_ids: awayIds,
    p_result_recorded_at: resultRecordedAt,
    p_history_rows: historyRows,
    p_player_ratings: playerRatings,
  })

  if (error) throw error
}

export async function recordForfeit(
  matchId: string,
  forfeitTeamId: string,
  homeTeamId: string,
  awayTeamId: string,
): Promise<void> {
  const { data: match, error: matchError } = await supabase
    .from('matches')
    .select(
      'home_team_id, away_team_id, home_pool_player_ids, away_pool_player_ids, result_recorded_at',
    )
    .eq('id', matchId)
    .single()
  if (matchError) throw matchError

  if (match.home_team_id !== homeTeamId || match.away_team_id !== awayTeamId) {
    throw new Error('Match teams changed; refresh and try again')
  }
  validateForfeitTeam(forfeitTeamId, match.home_team_id, match.away_team_id)
  const winnerTeamId =
    forfeitTeamId === match.home_team_id ? match.away_team_id : match.home_team_id

  let homeIds = match.home_pool_player_ids ?? []
  let awayIds = match.away_pool_player_ids ?? []
  if (homeIds.length !== 2 || awayIds.length !== 2) {
    const current = await fetchTeamPoolPlayerIds(match.home_team_id, match.away_team_id)
    if (homeIds.length !== 2) homeIds = current.homeIds
    if (awayIds.length !== 2) awayIds = current.awayIds
  }

  const resultRecordedAt = match.result_recorded_at ?? new Date().toISOString()
  const { historyRows, playerRatings } = await buildRatingsReplacement({
    matchId,
    mode: 'exclude',
  })

  const { error } = await supabase.rpc('save_match_and_ratings_atomic', {
    p_match_id: matchId,
    p_status: 'forfeit',
    p_winner_team_id: winnerTeamId,
    p_home_score: null,
    p_away_score: null,
    p_home_pool_player_ids: homeIds,
    p_away_pool_player_ids: awayIds,
    p_result_recorded_at: resultRecordedAt,
    p_history_rows: historyRows,
    p_player_ratings: playerRatings,
  })

  if (error) throw error
}

export async function revertMatchToScheduled(matchId: string): Promise<void> {
  const { historyRows, playerRatings } = await buildRatingsReplacement({
    matchId,
    mode: 'exclude',
  })
  const { error } = await supabase.rpc('save_match_and_ratings_atomic', {
    p_match_id: matchId,
    p_status: 'scheduled',
    p_winner_team_id: null,
    p_home_score: null,
    p_away_score: null,
    p_home_pool_player_ids: null,
    p_away_pool_player_ids: null,
    p_result_recorded_at: null,
    p_history_rows: historyRows,
    p_player_ratings: playerRatings,
  })

  if (error) throw error
}

export async function setMatchLiveStatus(
  matchId: string,
  liveStatus: MatchLiveStatus,
): Promise<void> {
  const { error } = await supabase.rpc('set_match_live_status', {
    p_match_id: matchId,
    p_live_status: liveStatus,
  })
  if (error) throw error
}

export async function setPlayerPresence(playerId: string, isPresent: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_player_presence', {
    p_player_id: playerId,
    p_is_present: isPresent,
  })
  if (error) throw error
}

export async function seedMatchUpNext(matchId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('seed_match_up_next', {
    p_match_id: matchId,
  })
  if (error) throw error
  return data as boolean
}

export async function setLiveCourtCount(seasonId: string, courtCount: number): Promise<void> {
  const { error } = await supabase.rpc('set_live_court_count', {
    p_season_id: seasonId,
    p_court_count: courtCount,
  })
  if (error) throw error
}

export async function saveTeamWithPlayers(
  seasonId: string,
  teamId: string,
  teamName: string,
  players: { id: string; poolPlayerId: string }[],
): Promise<void> {
  if (players.length !== 2) {
    throw new Error('A team must have exactly 2 players')
  }

  await assertPoolPlayersAvailable(
    seasonId,
    players.map((player) => player.poolPlayerId),
    teamId,
  )

  const { error } = await supabase.rpc('save_season_teams_atomic', {
    p_season_id: seasonId,
    p_teams: [{
      id: teamId,
      name: teamName.trim(),
      poolPlayerIds: players.map((player) => player.poolPlayerId),
    }],
  })
  if (error) throw error
}

export async function createTeamWithPlayers(
  seasonId: string,
  payload: {
    name: string
    color: string
    poolPlayerIds: [string, string]
  },
): Promise<TeamWithPlayers> {
  await assertPoolPlayersAvailable(seasonId, payload.poolPlayerIds)

  const { data: teamIds, error } = await supabase.rpc('save_season_teams_atomic', {
    p_season_id: seasonId,
    p_teams: [{
      name: payload.name.trim(),
      color: payload.color,
      poolPlayerIds: payload.poolPlayerIds,
    }],
  })
  if (error) throw error

  const teamId = (teamIds as string[] | null)?.[0]
  if (!teamId) throw new Error('Team was created but no ID was returned')

  const { data: team, error: fetchError } = await supabase
    .from('teams')
    .select('*, players(*)')
    .eq('id', teamId)
    .single()
  if (fetchError) throw fetchError
  return team as TeamWithPlayers
}

export async function createManyTeamsWithPlayers(
  seasonId: string,
  teams: {
    name: string
    color: string
    poolPlayerIds: [string, string]
  }[],
): Promise<number> {
  if (teams.length === 0) return 0

  const { data, error } = await supabase.rpc('save_season_teams_atomic', {
    p_season_id: seasonId,
    p_teams: teams.map((team) => ({
      name: team.name.trim(),
      color: team.color,
      poolPlayerIds: team.poolPlayerIds,
    })),
  })
  if (error) throw error
  return (data as string[] | null)?.length ?? 0
}

/**
 * Delete all fixtures and teams for a season that has no recorded results yet.
 * Blocked once any completed or forfeit match exists.
 */
export async function deleteAllSeasonTeams(seasonId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_all_season_teams_atomic', {
    p_season_id: seasonId,
  })
  if (error) throw error
}

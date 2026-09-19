import { buildRoundRobinMatches } from './schedule'
import { supabase } from './supabase'
import type { League } from '../types'

export interface SharedPlayerIdentity {
  id: string
  name: string
  leagueNames: string[]
}

export interface LeagueSetupPlayer {
  id: string
  name: string
  isNew: boolean
  initialRating: number
}

export interface LeagueSetupTeam {
  name: string
  color: string
  poolPlayerIds: [string, string]
}

export interface CreateLeagueSetupInput {
  name: string
  seasonName: string
  logoFile?: File | null
  players: LeagueSetupPlayer[]
  teams: LeagueSetupTeam[]
}

export interface CreateLeagueSetupResult {
  league: League
  logoWarning: string | null
}

export async function fetchLeagues(): Promise<League[]> {
  const { data, error } = await supabase
    .from('leagues')
    .select('*')
    .order('is_default', { ascending: false })
    .order('created_at')
  if (error) throw error
  return (data ?? []) as League[]
}

export async function fetchDefaultLeague(): Promise<League | null> {
  const { data, error } = await supabase
    .from('leagues')
    .select('*')
    .eq('is_default', true)
    .maybeSingle()
  if (error) throw error
  return data as League | null
}

export async function fetchSharedPlayerIdentities(): Promise<SharedPlayerIdentity[]> {
  const { data, error } = await supabase
    .from('player_pool')
    .select('id, name, league_players(leagues(name))')
    .order('name')
  if (error) throw error
  return (data ?? []).map((player) => ({
    id: player.id,
    name: player.name,
    leagueNames: [
      ...new Set(
        (player.league_players ?? [])
          .flatMap((membership) => {
            const leagues = membership.leagues as unknown as
              | { name: string }
              | { name: string }[]
              | null
            if (Array.isArray(leagues)) return leagues.map((league) => league.name)
            return leagues?.name ? [leagues.name] : []
          }),
      ),
    ].sort((a, b) => a.localeCompare(b)),
  }))
}

export async function addExistingPlayerToLeague(
  leagueId: string,
  poolPlayerId: string,
  initialRating: number,
): Promise<void> {
  const { error } = await supabase.rpc('add_existing_player_to_league', {
    p_league_id: leagueId,
    p_pool_player_id: poolPlayerId,
    p_initial_rating: initialRating,
  })
  if (error) throw error
}

export function slugifyLeagueName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'league'
}

export function buildLeagueSetupMatches(seasonId: string, teamIds: string[]) {
  if (teamIds.length < 2) return []
  return buildRoundRobinMatches(seasonId, teamIds)
}

export async function uploadLeagueLogo(leagueId: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('League logo must be an image file.')
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('League logo must be 2 MB or smaller.')
  }

  const objectPath = `${leagueId}/logo`
  const { error: uploadError } = await supabase.storage
    .from('league-logos')
    .upload(objectPath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: true,
    })
  if (uploadError) throw uploadError

  const { data } = supabase.storage.from('league-logos').getPublicUrl(objectPath)
  const publicUrl = `${data.publicUrl}?v=${Date.now()}`
  const { error: updateError } = await supabase
    .from('leagues')
    .update({ logo_url: publicUrl })
    .eq('id', leagueId)
  if (updateError) throw updateError
  return publicUrl
}

export async function updateLeagueBranding(
  leagueId: string,
  name: string,
  logoFile?: File | null,
): Promise<League> {
  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('League name is required.')

  const { data, error } = await supabase
    .from('leagues')
    .update({ name: trimmedName })
    .eq('id', leagueId)
    .select()
    .single()
  if (error) throw error

  if (!logoFile) return data as League
  const logoUrl = await uploadLeagueLogo(leagueId, logoFile)
  return { ...(data as League), logo_url: logoUrl }
}

export async function updateLeagueStatus(
  leagueId: string,
  status: League['status'],
): Promise<void> {
  const { error } = await supabase
    .from('leagues')
    .update({ status })
    .eq('id', leagueId)
  if (error) throw error
}

export async function createLeagueWithSetup(
  input: CreateLeagueSetupInput,
): Promise<CreateLeagueSetupResult> {
  const leagueId = crypto.randomUUID()
  const seasonId = crypto.randomUUID()
  const baseSlug = slugifyLeagueName(input.name)
  const { data: existingSlugs, error: slugError } = await supabase
    .from('leagues')
    .select('slug')
  if (slugError) throw slugError
  const usedSlugs = new Set((existingSlugs ?? []).map((league) => league.slug))
  let slug = baseSlug
  let suffix = 2
  while (usedSlugs.has(slug)) {
    slug = `${baseSlug}-${suffix}`
    suffix += 1
  }
  const teamsWithIds = input.teams.map((team) => ({
    ...team,
    id: crypto.randomUUID(),
  }))
  const matches = buildLeagueSetupMatches(
    seasonId,
    teamsWithIds.map((team) => team.id),
  )

  const { error } = await supabase.rpc('create_league_atomic', {
    p_league_id: leagueId,
    p_slug: slug,
    p_name: input.name.trim(),
    p_season_id: seasonId,
    p_season_name: input.seasonName.trim(),
    p_players: input.players.map((player) => ({
      id: player.id,
      name: player.name.trim(),
      is_new: player.isNew,
      initial_rating: player.initialRating,
    })),
    p_teams: teamsWithIds.map((team) => ({
      id: team.id,
      name: team.name.trim(),
      color: team.color,
      poolPlayerIds: team.poolPlayerIds,
    })),
    p_matches: matches.map((match) => ({
      home_team_id: match.home_team_id,
      away_team_id: match.away_team_id,
      round_number: match.round_number,
    })),
  })
  if (error) throw error

  let logoWarning: string | null = null
  if (input.logoFile) {
    try {
      await uploadLeagueLogo(leagueId, input.logoFile)
    } catch (logoError) {
      logoWarning = (logoError as Error).message
    }
  }

  const { data: league, error: leagueError } = await supabase
    .from('leagues')
    .select('*')
    .eq('id', leagueId)
    .single()
  if (leagueError) throw leagueError

  return { league: league as League, logoWarning }
}

import { describe, expect, it } from 'vitest'
import { buildLeagueSetupMatches, slugifyLeagueName } from './leagueApi'

describe('slugifyLeagueName', () => {
  it('creates a stable URL-friendly slug', () => {
    expect(slugifyLeagueName('  Sunday Pickleball Club  ')).toBe('sunday-pickleball-club')
  })

  it('normalizes Vietnamese names', () => {
    expect(slugifyLeagueName('Giải Đấu Đà Nẵng')).toBe('giai-dau-da-nang')
  })

  it('uses a safe fallback when the name has no URL characters', () => {
    expect(slugifyLeagueName('🏓')).toBe('league')
  })
})

describe('buildLeagueSetupMatches', () => {
  it('allows a league to be created before teams are added', () => {
    expect(buildLeagueSetupMatches('season-1', [])).toEqual([])
  })

  it('builds the schedule once at least two teams exist', () => {
    expect(buildLeagueSetupMatches('season-1', ['team-1', 'team-2'])).toEqual([
      {
        season_id: 'season-1',
        home_team_id: 'team-1',
        away_team_id: 'team-2',
        round_number: 1,
        status: 'scheduled',
      },
    ])
  })
})

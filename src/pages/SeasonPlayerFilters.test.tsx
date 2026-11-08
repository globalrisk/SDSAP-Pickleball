// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MatchWithTeams, PoolPlayer } from '../types'
import en from '../i18n/locales/en.json'
import { seasonMatchPlayers } from '../lib/playerMatches'

const state = vi.hoisted(() => ({ matches: [] as MatchWithTeams[], pool: [] as PoolPlayer[], seasonId: 's1', playerId: null as string | null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null, isAdmin: false }) }))
vi.mock('../context/LeagueContext', () => ({ useLeague: () => ({ league: { id: 'league', status: 'active' }, leaguePath: (path: string) => path }) }))
vi.mock('../context/SeasonContext', () => ({ useSeason: () => ({ selectedSeason: { id: state.seasonId, name: 'Selected season', status: 'active', format: 'team_duel' }, seasons: [], isSelectedSeasonActive: true }) }))
vi.mock('../hooks/useMatches', () => ({ useMatches: () => ({ data: state.matches, isSuccess: true }) }))
vi.mock('../hooks/usePlayerPool', () => ({ usePlayerPool: () => ({ data: state.pool, isSuccess: true }) }))
vi.mock('../hooks/useTeams', () => ({ useTeams: () => ({ data: [] }) }))
vi.mock('../hooks/usePlayerPreference', () => ({ usePlayerPreference: () => ({ playerId: state.playerId, remember: true, storageAvailable: true, selectPlayer: vi.fn(), setRemember: vi.fn() }) }))
vi.mock('../hooks/usePlayerProfile', () => ({ usePlayerProfile: () => ({ data: { history: [], rivalries: { byOpponent: [] } } }) }))
vi.mock('../hooks/useTournamentRealtime', () => ({ useTournamentRealtime: vi.fn() }))
vi.mock('../hooks/useBets', () => ({ useBetData: () => ({ account: {}, wallet: {}, bets: { data: [] } }) }))
vi.mock('../lib/confirmation', () => ({ useConfirm: () => async () => false }))
vi.mock('../components/Select', () => ({ Select: ({ children, onValueChange, ...props }: ComponentProps<'select'> & { onValueChange: (value: string) => void }) => <select {...props} onChange={e => onValueChange(e.target.value)}>{children}</select> }))
vi.mock('../components/MatchCard', () => ({ MatchCard: ({ match }: { match: MatchWithTeams }) => <article data-match-id={match.id} /> }))
vi.mock('../components/LeagueTeamDuelScoreboard', () => ({ LeagueTeamDuelScoreboard: () => null }))
vi.mock('../components/ArchivedSeasonBanner', () => ({ ArchivedSeasonBanner: () => null }))
vi.mock('../components/Layout', () => ({ SetupBanner: () => null, PageHeader: () => null, ErrorState: ({ message }: { message: string }) => <p>{message}</p> }))
import { PersonalTournamentCard } from '../components/PersonalTournamentCard'
import { MatchesPage } from './Matches'

function fixture(id: string, overrides: Partial<MatchWithTeams> = {}): MatchWithTeams {
  return {
    id, season_id: 's1', home_team_id: 'home', away_team_id: 'away',
    status: 'scheduled', live_status: 'available', live_court_number: null,
    home_score: null, away_score: null, winner_team_id: null, round_number: 1,
    home_pool_player_ids: ['a', 'b'], away_pool_player_ids: ['c', 'd'],
    result_recorded_at: null, created_at: '', winner: null,
    home_team: { id: 'home', name: 'Home', color: '', players: ['a', 'b', 'reserve'].map(id => ({ name: id.toUpperCase(), pool_player_id: id, is_present: true })) },
    away_team: { id: 'away', name: 'Away', color: '', players: ['c', 'd'].map(id => ({ name: id.toUpperCase(), pool_player_id: id, is_present: true })) },
    ...overrides,
  }
}

function render(page: 'Home' | 'Matches') {
  const i18n = createInstance()
  void i18n.init({ lng: 'en', initAsync: false, resources: { en: { translation: en } } })
  const client = new QueryClient()
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter>{page === 'Home' ? <PersonalTournamentCard /> : <MatchesPage />}</MemoryRouter></I18nextProvider></QueryClientProvider>)
  client.clear()
  return container
}
function optionIds(container: HTMLDivElement) {
  return [...container.querySelectorAll('select option')].map(option => (option as HTMLOptionElement).value).filter(id => id && id !== 'all')
}

beforeEach(() => {
  state.seasonId = 's1'; state.playerId = null
  state.pool = ['a', 'b', 'c', 'd', 'reserve', 'outsider', 'e', 'f'].map(id => ({ id, name: id.toUpperCase(), status: 'active', rating: 1500, rating_deviation: 90, initial_rating: 1500, volatility: 0, created_at: '' }))
  state.matches = [fixture('scheduled'), fixture('completed', { status: 'completed' }), fixture('other-season', { season_id: 's2', home_pool_player_ids: ['e', 'f'] })]
})

describe('season participant filters', () => {
  for (const page of ['Home', 'Matches'] as const) {
    it(`${page} lists only distinct fixture participants in the selected season`, () => {
      expect(optionIds(render(page))).toEqual(['a', 'b', 'c', 'd'])
      state.seasonId = 's2'
      expect(optionIds(render(page))).toEqual(['c', 'd', 'e', 'f'])
      state.matches = []
      expect(optionIds(render(page))).toEqual([])
    })
  }
  it('Home ignores a remembered nonparticipant and restores them in their season', () => {
    state.playerId = 'e'
    const home = render('Home')
    expect(home.querySelector('select')?.value).toBe('')
    expect(home.textContent).toContain(en.personal.playerUnavailable)
    state.seasonId = 's2'
    expect(render('Home').querySelector('select')?.value).toBe('e')
  })
  it('keeps archived participants even if now inactive and resolves snapshot names from the pool', () => {
    state.pool[0]!.status = 'inactive'; state.pool[0]!.name = 'Renamed player'
    state.matches = [fixture('historical', { home_team: { id: 'home', name: 'Home', color: '', players: [] } })]
    for (const page of ['Home', 'Matches'] as const) {
      const view = render(page)
      expect(optionIds(view)).toEqual(['b', 'c', 'd', 'a'])
      expect(view.querySelector('option[value="a"]')?.textContent).toBe('Renamed player')
    }
  })
  it('retains fixed-pair legacy fixtures and never falls back to the whole league', () => {
    const legacy = fixture('legacy', { home_pool_player_ids: null, away_pool_player_ids: null })
    legacy.home_team.players = legacy.home_team.players!.slice(0, 2)
    expect(seasonMatchPlayers([legacy], 's1', state.pool).map(player => player.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(seasonMatchPlayers([legacy], undefined, state.pool)).toEqual([])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import { createInstance } from 'i18next'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import en from '../i18n/locales/en.json'
import type { PlayerProfile, PoolPlayer } from '../types'
const state = vi.hoisted(() => ({ user: { id: 'user', email: 'private@example.test' } as { id: string; email: string } | null, admin: false, account: null as { playerId: string; name: string } | null, players: [] as PoolPlayer[], profile: null as PlayerProfile | null, profileCalls: 0, pointsCalls: 0 }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: state.user, isAdmin: state.admin, isLoading: false, changePassword: vi.fn() }) }))
vi.mock('../context/LeagueContext', () => ({ useLeague: () => ({ league: { id: 'league', name: 'Current league' }, leaguePath: (path = '') => `/leagues/current${path}` }) }))
vi.mock('../context/SeasonContext', () => ({ useSeason: () => ({ selectedSeason: null, isLoading: false, isError: false }) }))
vi.mock('../hooks/useBets', () => ({
  useMyPlayerAccount: () => ({ data: state.account, isSuccess: true, isLoading: false, isError: false }),
  useBetData: () => { state.pointsCalls++; return { wallet: { data: { balance: '1000', available: '750', reserved: '250', owed: '0' } }, history: { data: [] } } },
}))
vi.mock('../hooks/usePlayerPool', () => ({ usePlayerPool: () => ({ data: state.players, isLoading: false, isError: false }) }))
vi.mock('../hooks/usePlayerProfile', () => ({ usePlayerProfile: () => { state.profileCalls++; return { data: state.profile, isLoading: false, isError: false } } }))
vi.mock('../hooks/useMatches', () => ({ useMatches: () => ({ data: [], isLoading: false, isError: false }) }))
vi.mock('../hooks/useTournamentRealtime', () => ({ useTournamentRealtime: () => {} }))
vi.mock('../components/PlayerSkills', () => ({ PlayerSkills: () => <div>Player skills</div> }))
import { MyProfilePage } from './MyProfile'
import { SignedInRoute } from '../components/SignedInRoute'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
const member: PoolPlayer = { id: 'player', name: 'Linked player', status: 'active', rating: 1500, initial_rating: 1500, rating_deviation: 275, volatility: 0, created_at: '' }
const profile: PlayerProfile = { id: 'player', name: 'Linked player', rating: 1500, initialRating: 1500, ratingDeviation: 275, rank: null, provisional: true, played: 0, wins: 0, losses: 0, winRate: 0, form: [], ratingDelta: 0, history: [], title: null, funStats: { currentStreak: null, bestPartner: null, toughestOpponent: null, biggestSwing: null }, rivalries: { nemesis: null, favoriteOpponent: null, byOpponent: [] } }
const render = (tab = 'overview', guarded = false) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[`/leagues/current/me?tab=${tab}`]}>{guarded ? <SignedInRoute><MyProfilePage /></SignedInRoute> : <MyProfilePage />}</MemoryRouter></I18nextProvider></QueryClientProvider>)
beforeEach(() => { state.user = { id: 'user', email: 'private@example.test' }; state.admin = false; state.account = null; state.players = []; state.profile = profile; state.profileCalls = 0; state.pointsCalls = 0 })
describe('Personal hub identity and membership boundaries', () => {
  it('does not render the private hub for a signed-out visitor', () => {
    state.user = null
    expect(render('points', true)).not.toContain('My Profile')
    expect(state.pointsCalls).toBe(0)
  })
  it('shows unlinked guidance without requesting stats or wallets', () => {
    expect(render('points')).toContain('Ask an administrator')
    expect(state.pointsCalls).toBe(0); expect(state.profileCalls).toBe(0)
    expect(render('settings')).toContain('private@example.test')
    expect(render('settings')).toContain('Change password')
    expect(render('settings')).not.toContain('Save player name')
  })
  it('keeps settings available to a linked non-member while gating league data', () => {
    state.account = { playerId: 'other-player', name: 'Another player' }
    expect(render('points')).toContain('not a member of Current league')
    expect(state.pointsCalls).toBe(0); expect(state.profileCalls).toBe(0)
    expect(render('settings')).toContain('Another player')
    expect(render('settings')).toContain('Save player name')
  })
  it('uses the owned identity, keeps email in settings, and renders inactive history', () => {
    state.account = { playerId: 'player', name: 'Linked player' }
    state.players = [{ ...member, status: 'inactive' }]
    const html = render()
    expect(html).toContain('Linked player')
    expect(html).toContain('membership is inactive')
    expect(html).toContain('Current rating')
    expect(html).toContain('Player skills')
    expect(render('stats')).toContain('Player skills')
    expect(html).not.toContain('private@example.test')
    expect(render('points')).toContain('750')
    expect(state.pointsCalls).toBe(1)
  })
  it('provides administrator username settings without requiring a player link', () => {
    state.admin = true
    const html = render('settings')
    expect(html).toContain('Manage administrator username')
    expect(html).toContain('/leagues/current/account')
    expect(state.profileCalls).toBe(0)
  })
})

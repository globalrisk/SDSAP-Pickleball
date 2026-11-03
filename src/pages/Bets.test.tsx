import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import { createInstance } from 'i18next'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfirmationContext } from '../lib/confirmation'
import type { PickleBet, PickleTransaction } from '../lib/betsApi'
import en from '../i18n/locales/en.json'
import viLocale from '../i18n/locales/vi.json'

const state = vi.hoisted(() => ({ bets: [] as PickleBet[], transactions: [] as PickleTransaction[], loading: false, error: null as Error | null, admin: false }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user' }, isAdmin: state.admin }) }))
vi.mock('../context/LeagueContext', () => ({ useLeague: () => ({ league: { id: 'league', status: 'active' }, leaguePath: (path: string) => path }) }))
vi.mock('../context/SeasonContext', () => ({ useSeason: () => ({ selectedSeason: { id: 'season', name: 'Season 15', status: 'active' } }) }))
vi.mock('../hooks/useMatches', () => ({ useMatches: () => ({ data: [] }) }))
vi.mock('../hooks/usePlayerPool', () => ({ usePlayerPool: () => ({ data: [{ id: 'player', status: 'active' }], isSuccess: true }) }))
vi.mock('../hooks/useBets', () => ({ useBetData: () => ({
  account: { data: { playerId: 'player', name: 'Player' } },
  wallet: { data: { balance: '10000', available: '10000', reserved: '0', owed: '0' } },
  bets: { data: state.bets }, history: { data: state.transactions, isLoading: state.loading, error: state.error },
}) }))
import { BetsPage } from './Bets'

const bet: PickleBet = {
  id: 'bet', seasonId: 'season', matchId: 'match', creatorId: 'player', creatorName: 'Player',
  acceptorId: 'opponent', acceptorName: 'Opponent', creatorSide: 'home', homeTeamId: 'home', awayTeamId: 'away',
  homeNames: ['Alex', 'Bo'], awayNames: ['Cam', 'Drew'], creatorStake: '1000', acceptorStake: '5000',
  state: 'settled', createdAt: '2026-11-01T00:00:00Z', closeReason: null,
}
const payout: PickleTransaction = {
  id: 'payout', amount: '5000', kind: 'bet', seasonName: 'Season 15', betId: 'bet', matchId: 'match',
  revision: 1, reason: 'confirmed', createdAt: '2026-11-02T00:00:00Z',
}
function render(tab = 'history', lang = 'en') {
  const i18n = createInstance()
  void i18n.init({ lng: lang, initAsync: false, resources: { en: { translation: en }, vi: { translation: viLocale } }, interpolation: { escapeValue: false } })
  return renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><I18nextProvider i18n={i18n}>
    <MemoryRouter initialEntries={[`/bets?tab=${tab}`]}><ConfirmationContext.Provider value={async () => false}><BetsPage /></ConfirmationContext.Provider></MemoryRouter>
  </I18nextProvider></QueryClientProvider>)
}
beforeEach(() => { state.bets = [bet]; state.transactions = [payout]; state.loading = false; state.error = null; state.admin = false })

describe('Simple personal bet history', () => {
  it('shows an actual win and net profit while collapsing the technical log', () => {
    const html = render()
    expect(html).toContain('You won')
    expect(html).toContain('+5.000 🥒')
    expect(html).toContain('You backed Alex + Bo')
    expect(html).not.toContain(en.betSlip.profitIfWon)
    expect(html).not.toContain(en.betSlip.totalReturn)
    expect(html).not.toContain(en.matchBets.startTitle)
    expect(html).toMatch(/<details\b[^>]*><summary[^>]*>Point transactions<\/summary>/)
    expect(html).not.toMatch(/<details[^>]*\bopen/)
  })

  it('uses the acceptor’s own payout and backed pair for a loss', () => {
    state.bets = [{ ...bet, creatorId: 'opponent', acceptorId: 'player' }]
    state.transactions = [{ ...payout, amount: '-5000' }]
    const html = render()
    expect(html).toContain('You lost')
    expect(html).toContain('-5.000 🥒')
    expect(html).toContain('You backed Cam + Drew')
  })

  it.each(['refunded', 'cancelled', 'void'] as const)('shows %s without claiming a win or loss', outcome => {
    state.bets = [{ ...bet, state: outcome }]; state.transactions = []
    const html = render()
    expect(html).toContain(en.betHistory[outcome])
    expect(html).toContain('Net points: 0 🥒')
    expect(html).not.toContain('You won'); expect(html).not.toContain('You lost')
  })

  it('waits for payouts and reports loading failures instead of guessing a result', () => {
    state.loading = true
    expect(render()).not.toContain('You won')
    expect(render()).toContain(en.common.loading)
    state.loading = false; state.error = new Error('Cannot load payouts')
    expect(render()).toContain('Cannot load payouts')
    expect(render()).not.toContain('You won')
  })

  it('keeps pending offers on the normal offer card', () => {
    state.bets = [{ ...bet, state: 'accepted' }]
    const html = render('mine')
    expect(html).toContain(en.betSlip.profitIfWon)
    expect(html).not.toContain('You won')
  })

  it('renders the history result in Vietnamese', () => {
    const html = render('history', 'vi')
    expect(html).toContain(viLocale.betHistory.won)
    expect(html).toContain('Bạn chọn Alex + Bo thắng')
    expect(html).not.toContain('betHistory.')
  })

  it('keeps administrator payout tools on the offer tabs, outside personal history', () => {
    state.admin = true
    expect(render()).not.toContain(en.bets.adminReview)
    expect(render('mine')).toContain(en.bets.adminReview)
  })

  it('orders history by the most recent payout instead of the offer creation date', () => {
    state.bets.push({ ...bet, id: 'newer-offer', homeNames: ['Eli', 'Finn'], createdAt: '2026-11-02T00:00:00Z' })
    state.transactions = [{ ...payout, createdAt: '2026-11-03T00:00:00Z' }, { ...payout, id: 'other', betId: 'newer-offer' }]
    const html = render()
    expect(html.indexOf('You backed Alex + Bo')).toBeLessThan(html.indexOf('You backed Eli + Finn'))
  })
})

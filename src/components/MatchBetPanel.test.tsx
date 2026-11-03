import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import en from '../i18n/locales/en.json'
import { ConfirmationContext } from '../lib/confirmation'
import { createBet, type PickleBet } from '../lib/betsApi'
import type { MatchWithTeams } from '../types'
import { MatchBetPanel } from './MatchBetPanel'

// Exercise the real query mutations without requiring a browser DOM.
const mutations = vi.hoisted(() => [] as Array<(variables: unknown) => Promise<unknown>>)
vi.mock('@tanstack/react-query', async importOriginal => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useMutation: (...args: Parameters<typeof actual.useMutation>) => {
    const mutation = actual.useMutation(...args)
    mutations.push(mutation.mutateAsync)
    return mutation
  } }
})
vi.mock('../lib/betsApi', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/betsApi')>(), createBet: vi.fn(),
}))

const i18n = createInstance()
beforeEach(() => { mutations.length = 0; vi.mocked(createBet).mockReset() })
beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})
const match = {
  id: 'match', home_team_id: 'home', away_team_id: 'away', status: 'scheduled',
  live_status: 'available', betting_closed_at: null,
  home_pool_player_ids: ['h1', 'h2'], away_pool_player_ids: ['a1', 'a2'],
  home_team: { players: [{ pool_player_id: 'h1', name: 'Home one' }, { pool_player_id: 'h2', name: 'Home two' }] },
  away_team: { players: [{ pool_player_id: 'a1', name: 'Away one' }, { pool_player_id: 'a2', name: 'Away two' }] },
} as MatchWithTeams
const bet: PickleBet = {
  id: 'offer', seasonId: 'season', matchId: 'match', creatorId: 'spectator', creatorName: 'Spectator',
  acceptorId: null, acceptorName: null, creatorSide: 'away', homeTeamId: 'home', awayTeamId: 'away',
  homeNames: ['Home one', 'Home two'], awayNames: ['Away one', 'Away two'],
  creatorStake: '1000', acceptorStake: '1000', state: 'open', createdAt: '2026-10-19T00:00:00Z', closeReason: null,
}
function render(props: Partial<ComponentProps<typeof MatchBetPanel>> = {}, client = new QueryClient()) {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>
    <QueryClientProvider client={client}>
      <ConfirmationContext.Provider value={async () => false}>
        <MatchBetPanel match={match} playerId="h1" wallet={{ balance: '10000', available: '10000', reserved: '0', owed: '0' }}
          pool={[]} offers={[]} view="offer" onViewChange={() => {}} onCreated={() => {}} eligible {...props} />
      </ConfirmationContext.Provider>
    </QueryClientProvider>
  </I18nextProvider>)
}
const buttons = (html: string) => html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []

describe('Self betting panel', () => {
  it.each(['h1', 'a1'])('preselects the own pair and disables the opposite pair for %s', playerId => {
    const html = render({ playerId })
    const pairButtons = buttons(html).filter(button => button.includes('Home one') || button.includes('Away one'))
    const own = pairButtons.find(button => button.includes(playerId === 'h1' ? 'Home one' : 'Away one'))!
    const opposing = pairButtons.find(button => button !== own)!
    expect(own).toContain('aria-pressed="true"')
    expect(own).not.toContain('disabled=""')
    expect(opposing).toContain('disabled=""')
    expect(html).toContain(en.matchBets.ownSideOnly)
    expect(buttons(html).find(button => button.includes(en.betSlip.reviewCreate))).not.toContain('disabled=""')
  })

  it('lets spectators select either pair without an automatic choice', () => {
    const html = render({ playerId: 'spectator' })
    const pairButtons = buttons(html).filter(button => button.includes('Home one') || button.includes('Away one'))
    expect(pairButtons).toHaveLength(2)
    for (const button of pairButtons) {
      expect(button).not.toContain('disabled=""')
      expect(button).toContain('aria-pressed="false"')
    }
    expect(html).not.toContain(en.matchBets.ownSideOnly)
  })

  it('enables acceptance only when the offer backs the opposing pair', () => {
    const allowed = render({ view: 'offers', offers: [bet] })
    expect(buttons(allowed).find(button => button.includes(en.betSlip.reviewOffer))).not.toContain('disabled=""')
    const blocked = render({ view: 'offers', offers: [{ ...bet, creatorSide: 'home' }] })
    expect(buttons(blocked).find(button => button.includes(en.betSlip.unavailable))).toContain('disabled=""')
  })

  it('keeps the full offer form disabled after betting closes', () => {
    expect(render({ match: { ...match, live_status: 'playing' } })).toContain('<fieldset disabled="">')
  })

  it('closes creation only after the offer is saved, before refreshing balances and offers', async () => {
    let save!: (id: string) => void
    vi.mocked(createBet).mockReturnValue(new Promise(resolve => { save = resolve }))
    const onCreated = vi.fn()
    const client = new QueryClient()
    const refresh = vi.spyOn(client, 'invalidateQueries').mockImplementation(async () => {
      expect(onCreated).toHaveBeenCalledExactlyOnceWith()
    })
    render({ onCreated }, client)
    const submitted = mutations[0]!(undefined)
    await vi.waitFor(() => expect(createBet).toHaveBeenCalledOnce())
    expect(onCreated).not.toHaveBeenCalled()
    save('new-offer')
    await submitted
    expect(onCreated).toHaveBeenCalledExactlyOnceWith()
    expect(refresh.mock.calls.map(([options]) => options?.queryKey)).toEqual([
      ['bets'], ['pickle-points'], ['matches'],
    ])
    client.clear()
  })

  it('keeps creation open after a failed save and allows a retry with the same request ID', async () => {
    vi.mocked(createBet).mockRejectedValueOnce(new Error('Save failed')).mockResolvedValueOnce('new-offer')
    const onCreated = vi.fn()
    const client = new QueryClient()
    const refresh = vi.spyOn(client, 'invalidateQueries').mockResolvedValue()
    render({ onCreated }, client)
    await expect(mutations[0]!(undefined)).rejects.toThrow('Save failed')
    expect(onCreated).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    await mutations[0]!(undefined)
    expect(onCreated).toHaveBeenCalledExactlyOnceWith()
    expect(vi.mocked(createBet).mock.calls[1]).toEqual(vi.mocked(createBet).mock.calls[0])
    client.clear()
  })
})

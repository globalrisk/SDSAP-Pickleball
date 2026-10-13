import { beforeAll, describe, expect, it } from 'vitest'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import en from '../i18n/locales/en.json'
import vi from '../i18n/locales/vi.json'
import type { PickleBet } from '../lib/betsApi'
import { BetOfferCard } from './BetOfferCard'
import { BetAcceptanceDetails } from './BetSlip'

const i18n = createInstance()
beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en }, vi: { translation: vi } }, interpolation: { escapeValue: false } })
})

const bet: PickleBet = {
  id: 'offer', seasonId: 'season', matchId: 'match', creatorId: 'creator', creatorName: 'Kizaru',
  acceptorId: null, acceptorName: null, creatorSide: 'away', homeTeamId: 'home', awayTeamId: 'away',
  homeNames: ['Trung', 'Huy'], awayNames: ['Hiệp', 'Tùng núi'], creatorStake: '8000', acceptorStake: '2000',
  state: 'open', createdAt: '2026-10-14T00:00:00Z', closeReason: null,
}
const wallet = { balance: '15000', reserved: '0', available: '15000', owed: '0' }
function render(props: Partial<ComponentProps<typeof BetOfferCard>> = {}) {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><BetOfferCard bet={bet} playerId="spectator" wallet={wallet} canReview onReview={() => {}} {...props} /></I18nextProvider>)
}

describe('Pair-first bet offers', () => {
  it('shows the acceptor pair and asymmetric stakes from a prospective bettor’s perspective', () => {
    const html = render()
    expect(html.indexOf('Trung')).toBeLessThan(html.indexOf('Hiệp'))
    expect(html).toContain('You back')
    expect(html).toContain('Kizaru backs')
    expect(html).toMatch(/Your stake<\/dt><dd[^>]*>2\.000 🥒/)
    expect(html).toMatch(/Profit if won<\/dt><dd[^>]*>\+8\.000 🥒/)
    expect(html).toContain('10.000 🥒')
    expect(html).toContain('If your pair loses: -2.000 🥒')
    expect(html).not.toContain('disabled=""')
  })

  it('keeps the creator’s pair, stake and profit correct on their own offer', () => {
    const html = render({ playerId: 'creator', onCancel: () => {} })
    expect(html.indexOf('Hiệp')).toBeLessThan(html.indexOf('Trung'))
    expect(html).toMatch(/Your stake<\/dt><dd[^>]*>8\.000 🥒/)
    expect(html).toMatch(/Profit if won<\/dt><dd[^>]*>\+2\.000 🥒/)
    expect(html).toContain('Cancel offer')
    expect(html).not.toContain('Review offer')
  })

  it('preserves the accepted bettor’s perspective after the offer closes', () => {
    const html = render({ bet: { ...bet, state: 'accepted', acceptorId: 'spectator', acceptorName: 'Bo' }, canReview: false })
    expect(html).toContain('You back')
    expect(html).toMatch(/Your stake<\/dt><dd[^>]*>2\.000 🥒/)
    expect(html).not.toContain('Review offer')
  })

  it('does not label an ineligible spectator as backing a pair', () => {
    const html = render({ canReview: false, unavailableReason: en.matchBets.participant })
    expect(html).not.toContain('You back')
    expect(html).toContain('Opposing pair')
    expect(html).toContain('Stake to accept')
    expect(html).toContain('Includes the stake to accept')
    expect(html).toContain(en.matchBets.participant)
    expect(html).toContain('disabled=""')
  })

  it('disables review and calculates a fractional shortfall without rounding the funds check', () => {
    const html = render({ wallet: { ...wallet, available: '1999.500000' } })
    expect(html).toContain('You need 0,5 🥒 more to accept this offer.')
    expect(html).toContain('Insufficient points')
    expect(html).toContain('disabled=""')
  })

  it('does not allow review before available funds have loaded', () => {
    const html = render({ wallet: undefined })
    expect(html).toContain(en.betSlip.fundsUnavailable)
    expect(html).toContain('disabled=""')
  })

  it('uses the same opposing pair and amounts in acceptance review', () => {
    const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><BetAcceptanceDetails bet={bet} /></I18nextProvider>)
    expect(html).toContain('Trung')
    expect(html).not.toContain('Hiệp')
    expect(html).toContain('2.000 🥒')
    expect(html).toContain('+8.000 🥒')
    expect(html).toContain('10.000 🥒')
  })

  it('renders all new labels in Vietnamese', () => {
    const instance = createInstance()
    void instance.init({ lng: 'vi', initAsync: false, resources: { vi: { translation: vi } } })
    const html = renderToStaticMarkup(<I18nextProvider i18n={instance}><BetOfferCard bet={bet} playerId="spectator" wallet={wallet} canReview onReview={() => {}} /></I18nextProvider>)
    expect(html).toContain(vi.betSlip.youBack)
    expect(html).toContain(vi.betSlip.totalReturn)
    expect(html).toContain(vi.betSlip.reviewOffer)
    expect(html).not.toContain('betSlip.')
  })
})

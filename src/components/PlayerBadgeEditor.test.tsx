import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../i18n/locales/en.json'
import viLocale from '../i18n/locales/vi.json'
const state = vi.hoisted(() => ({ admin: false, userId: null as string | null, playerId: null as string | null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ isAdmin: state.admin, user: state.userId ? { id: state.userId } : null }) }))
vi.mock('../hooks/useBets', () => ({ useMyPlayerAccount: () => ({ data: state.playerId ? { playerId: state.playerId } : null }) }))
vi.mock('../context/LeagueContext', () => ({ useLeague: () => ({ league: { id: 'league' } }) }))
import { PlayerBadgeEditor } from './PlayerBadgeEditor'
import { PlayerTitleBadge } from './PlayerTitleBadge'
const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: en }, vi: { translation: viLocale } } })
const render = () => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><I18nextProvider i18n={i18n}><PlayerBadgeEditor playerId="player" badge="" /></I18nextProvider></QueryClientProvider>)
beforeEach(async () => { state.admin = false; state.userId = null; state.playerId = null; await i18n.changeLanguage('en') })
describe('Player badge controls', () => {
  it('offers editing to administrators in both languages', async () => {
    expect(render()).toBe('')
    state.admin = true
    expect(render()).toContain('Edit badge')
    await i18n.changeLanguage('vi')
    expect(render()).toContain('Chỉnh sửa huy hiệu')
  })
  it('offers editing only for the signed-in player’s own linked profile', async () => {
    state.userId = 'user'
    expect(render()).toBe('')
    state.playerId = 'other-player'
    expect(render()).toBe('')
    state.playerId = 'player'
    expect(render()).toContain('Edit badge')
    await i18n.changeLanguage('vi')
    expect(render()).toContain('Chỉnh sửa huy hiệu')
    state.userId = null
    expect(render()).toBe('')
  })
  it('renders badge text literally and escapes markup', () => {
    const html = renderToStaticMarkup(<PlayerTitleBadge title={{ label: '<img src=x> Nhà vô địch' }} />)
    expect(html).toContain('&lt;img src=x&gt; Nhà vô địch')
    expect(html).not.toContain('<img')
  })
})

import { beforeAll, describe, expect, it } from 'vitest'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConfirmationContext } from '../lib/confirmation'
import { SeasonMatchDeletion, SeasonMatchDeletionSummary } from './SeasonMatchDeletion'
import type { MatchWithTeams, Season } from '../types'
import en from '../i18n/locales/en.json'
import vi from '../i18n/locales/vi.json'

const i18n = createInstance()
beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en }, vi: { translation: vi } }, interpolation: { escapeValue: false } })
})
const season = { id: 'season', name: 'Season 15', status: 'active' } as Season
const match = { status: 'scheduled', live_status: 'available', home_score: null, away_score: null, winner_team_id: null, result_recorded_at: null } as MatchWithTeams
function render(fixtures = [match], selectedSeason = season) {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><QueryClientProvider client={new QueryClient()}>
    <ConfirmationContext.Provider value={async () => false}><SeasonMatchDeletion season={selectedSeason} fixtures={fixtures} /></ConfirmationContext.Provider>
  </QueryClientProvider></I18nextProvider>)
}

describe('season match deletion controls', () => {
  it('offers a clearly named action for an unplayed season, including accepted-bet cleanup', () => {
    const html = render()
    expect(html).toContain(en.seasonDelete.button)
    expect(html).toContain('including accepted bets')
    expect(html).not.toContain('disabled=""')
  })
  it.each(['completed', 'forfeit', 'playing', 'empty', 'archived'])('disables deletion for %s', kind => {
    const fixtures = kind === 'empty' ? [] : [{ ...match, status: kind === 'completed' || kind === 'forfeit' ? kind : match.status, live_status: kind === 'playing' ? 'playing' as const : match.live_status }]
    expect(render(fixtures, kind === 'archived' ? { ...season, status: 'archived' } : season)).toContain('disabled=""')
  })
  it.each(['en', 'vi'])('shows the reviewed counts and released stakes in %s', lang => {
    const instance = createInstance()
    void instance.init({ lng: lang, initAsync: false, resources: { en: { translation: en }, vi: { translation: vi } } })
    const html = renderToStaticMarkup(<I18nextProvider i18n={instance}><SeasonMatchDeletionSummary preview={{
      seasonId: 'season', matchCount: 21, betCount: 21, openCount: 10, acceptedCount: 5, releasedPoints: '4000.000000', canDelete: true, fingerprint: 'review',
    }} /></I18nextProvider>)
    expect(html).toContain('21'); expect(html).toContain('10'); expect(html).toContain('5')
    expect(html).toContain('4.000 🥒')
    expect(html).not.toContain('seasonDelete.')
  })
})

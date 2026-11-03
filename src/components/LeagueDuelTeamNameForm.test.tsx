import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import en from '../i18n/locales/en.json'
import vi from '../i18n/locales/vi.json'
import { LeagueDuelTeamNameForm } from './LeagueDuelTeamNameForm'
import type { Team } from '../types'

function render(language: 'en' | 'vi', disabled = false) {
  const i18n = createInstance()
  void i18n.init({ lng: language, initAsync: false, resources: { en: { translation: en }, vi: { translation: vi } } })
  const team: Team = { id: 'team', season_id: 'season', name: 'My team', color: '#9333ea', created_at: '' }
  return renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><I18nextProvider i18n={i18n}>
    <LeagueDuelTeamNameForm team={team} disabled={disabled} />
  </I18nextProvider></QueryClientProvider>)
}

describe('Team appearance settings', () => {
  it.each(['en', 'vi'] as const)('shows the saved custom color and both suggested defaults in %s', language => {
    const html = render(language)
    const labels = language === 'en' ? en : vi
    expect(html).toContain(labels.leagueDuel.renameTeam.replace('&', '&amp;'))
    expect(html).toContain('type="color"')
    expect(html).toContain('value="#9333ea"')
    expect(html).toContain(labels.teamColors.blue)
    expect(html).toContain(labels.teamColors.orange)
    expect(html).not.toContain('teamColors.')
    expect(html).toMatch(/type="submit" disabled=""/)
  })

  it('disables custom colors and preset buttons while an action is pending', () => {
    const html = render('en', true)
    expect(html).toMatch(/type="color" disabled=""/)
    const presetButtons = html.match(/<button[^>]*type="button"[^>]*>/g) ?? []
    expect(presetButtons).toHaveLength(2)
    expect(presetButtons.every(button => button.includes('disabled=""'))).toBe(true)
  })
})

// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../i18n/locales/en.json'
import vietnamese from '../i18n/locales/vi.json'
import type { PoolPlayer, Season } from '../types'
import skeletons from '../../server/duel_skeletons.json'
import { duelScheduleId, measureDuelSchedule, type FlexibleDuelPlan } from '../lib/flexibleDuel'
import type { LeagueDuelGame } from '../lib/leagueDuelSchedule'

const mocks = vi.hoisted(() => ({ request: vi.fn(), search: vi.fn(), context: vi.fn(), save: vi.fn() }))
vi.mock('../context/LeagueContext', () => ({ useLeague: () => ({ league: { id: 'league' }, leaguePath: (path: string) => '/leagues/test' + path }) }))
vi.mock('../lib/leagueTeamDuelApi', () => ({ fetchFlexibleDuelContext: mocks.context, saveFlexibleDuelPlan: mocks.save }))
vi.mock('../lib/fastDuelApi', () => ({ requestFastDuel: mocks.request }))
vi.mock('../lib/fastDuelSearch', async importOriginal => ({ ...await importOriginal<typeof import('../lib/fastDuelSearch')>(), findFeasibleDuelSquads: mocks.search }))
import { FlexibleDuelSetup } from './FlexibleDuelSetup'

const pool = Array.from({ length: 14 }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, name: `Player ${i}`, rating: 1500, rating_deviation: 100, status: 'active' } as PoolPlayer))
const rosterIds = pool.map(p => p.id)
const context = { key: 'current-ratings', revision: 1, fingerprint: 'fp', pool, rosterIds, partnerHistory: [] }
const season = { id: 'season17', name: 'Season 17', status: 'active', format: 'team_duel', duel_draft_plan: null } as Season
const i18n = createInstance()
let root: Root, client: QueryClient, container: HTMLDivElement
const scroll = vi.fn()
const buttons = () => [...container.querySelectorAll('button')]
const searchButton = () => buttons().find(b => [en.flexibleDuel.search, en.flexibleDuel.shuffle, vietnamese.flexibleDuel.search, vietnamese.flexibleDuel.shuffle, en.flexibleDuel.continueConditions, vietnamese.flexibleDuel.continueConditions].includes(b.textContent!))!
const generationButton = () => buttons().find(b => /^(Generate|Tạo) 0/.test(b.textContent!))!

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  scroll.mockClear(); mocks.request.mockReset(); mocks.search.mockReset(); mocks.context.mockResolvedValue(context); mocks.save.mockReset()
  await i18n.init({ lng: 'en', resources: { en: { translation: en }, vi: { translation: vietnamese } }, interpolation: { escapeValue: false } })
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  client.setQueryData(['flexible-duel-context', season.id, [...rosterIds].sort().join(':')], context)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.unstubAllGlobals() })
async function render(language = 'en', draft?: FlexibleDuelPlan) {
  await i18n.changeLanguage(language)
  await act(async () => root.render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter><FlexibleDuelSetup season={{ ...season, duel_draft_plan: draft ?? null }} rosterIds={rosterIds} teams={[]} fixtures={[]} hasFixtures={false} editable /></MemoryRouter></I18nextProvider></QueryClientProvider>))
  const opponent = container.querySelector<HTMLSelectElement>(`select[aria-label="${language === 'en' ? en.flexibleDuel.maxOpponentMeetings : vietnamese.flexibleDuel.maxOpponentMeetings}"]`)!
  await act(async () => { opponent.value = '2'; opponent.dispatchEvent(new Event('change', { bubbles: true })) })
}

describe('Team Duel empty search feedback', () => {
  it('shows the verified squads and enables generation after conditions are met', async () => {
    const squads: [PoolPlayer[], PoolPlayer[]] = [pool.slice(0, 7), pool.slice(7)]
    const games: LeagueDuelGame[] = skeletons['7'].map((g, i) => ({ roundNumber: g.round, sequenceNumber: i + 1,
      homePoolPlayerIds: g.home.map(p => squads[0][p]!.id) as [string, string], awayPoolPlayerIds: g.away.map(p => squads[1][p]!.id) as [string, string] }))
    const option = { id: duelScheduleId(games), kind: 'balance', games, metrics: measureDuelSchedule(squads, games) }
    mocks.search.mockResolvedValue({ options: [option], status: 'FEASIBLE', split: { id: 'verified', squads: squads.map(s => s.map(p => p.id)), bestWorst: .5 } })
    await render()
    await act(async () => searchButton().click())
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('Your conditions can be met.')
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(1)
    const generate = buttons().find(b => b.textContent === 'Generate 21 selected matches')!
    expect(generate.disabled).toBe(false)
    expect(container.textContent).toContain('Player 13')
    expect(container.textContent).toContain('Opponents · 42/49 pairs')
    expect(container.textContent).toContain('Partners · 42/42 pairs')
    expect(container.textContent).toContain('Distinct partners per player · 6')
    const playerDetails = [...container.querySelectorAll('details li')].find(row => row.textContent?.startsWith('Player 13:'))
    expect(playerDetails?.textContent).toContain('6 distinct partners, 6 distinct opponents')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  for (const language of ['en', 'vi']) for (const status of ['INFEASIBLE', 'UNKNOWN']) it(`announces and focuses ${status} in ${language}, keeping generation disabled`, async () => {
    mocks.search.mockResolvedValue({ options: [], status, scope: 'roster' })
    await render(language)
    await act(async () => searchButton().click())
    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    const translation = language === 'en' ? en : vietnamese
    expect(alert!.textContent).toContain(translation.flexibleDuel.notice[status === 'INFEASIBLE' ? 'noValid' : 'rosterLimited'])
    expect(alert!.textContent).toContain('65/35')
    expect(document.activeElement).toBe(alert)
    expect(scroll).toHaveBeenCalled()
    expect(generationButton().disabled).toBe(true)
    expect(mocks.save).not.toHaveBeenCalled()
    // A background refresh of identical ratings must not erase the result.
    await act(async () => { await client.refetchQueries({ queryKey: ['flexible-duel-context'] }) })
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(translation.flexibleDuel.notice[status === 'INFEASIBLE' ? 'noValid' : 'rosterLimited'])
  })
  for (const engine of ['cp-sat', 'exhaustive', undefined] as const) for (const kind of ['balance', 'experience'] as const) it(`restores only current CP-SAT choices (${engine}, ${kind})`, async () => {
    const squads: [PoolPlayer[], PoolPlayer[]] = [pool.slice(0, 7), pool.slice(7)]
    const games: LeagueDuelGame[] = skeletons['7'].map((g, i) => ({ roundNumber: g.round, sequenceNumber: i + 1,
      homePoolPlayerIds: g.home.map(p => squads[0][p]!.id) as [string, string], awayPoolPlayerIds: g.away.map(p => squads[1][p]!.id) as [string, string] }))
    // Historical CP-SAT plans omitted maxRatingDifference; treat them as unlimited.
    const settings = { maxPartnerMeetings: 2, maxOpponentMeetings: 2, maxMatchProbability: .65 }
    const plan: FlexibleDuelPlan = { version: 1, engine, inputKey: JSON.stringify([1, context.key, settings]), settings,
      splitId: 'saved', squads: squads.map(s => s.map(p => p.id)) as [string[], string[]],
      option: { id: duelScheduleId(games), kind, games, metrics: measureDuelSchedule(squads, games) } }
    await render('en', plan)
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(engine === 'cp-sat' && kind === 'balance' ? 1 : 0)
    expect(container.textContent).not.toContain('Player experience')
    const gap = container.querySelector<HTMLSelectElement>(`select[aria-label="${en.flexibleDuel.maxRatingDifference}"]`)!
    expect(gap.value).toBe('none')
    if (engine === 'cp-sat' && kind === 'balance') {
      expect(container.textContent).toContain('Player details')
      await act(async () => { gap.value = 'limit'; gap.dispatchEvent(new Event('change', { bubbles: true })) })
      expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0)
      expect(generationButton().disabled).toBe(true)
    }
  })
  it('uses CP-SAT only and offers a ranking-point cap or No limit', async () => {
    await render()
    expect(container.querySelector('select[aria-label="Scheduling mode"]')).toBeNull()
    expect(container.textContent).not.toContain('Exhaustive')
    const gap = container.querySelector<HTMLSelectElement>(`select[aria-label="${en.flexibleDuel.maxRatingDifference}"]`)!
    expect(gap.value).toBe('none')
    await act(async () => { gap.value = 'limit'; gap.dispatchEvent(new Event('change', { bubbles: true })) })
    const points = container.querySelector<HTMLInputElement>(`input[aria-label="${en.flexibleDuel.ratingDifferencePoints}"]`)!
    expect(points.value).toBe('400')
    mocks.search.mockResolvedValue({ options: [], status: 'INFEASIBLE', scope: 'roster' })
    await act(async () => searchButton().click())
    expect(mocks.search.mock.calls[0]![0].settings.maxRatingDifference).toBe(400)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('ranking-point difference 400')
    await act(async () => { gap.value = 'none'; gap.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(container.querySelector(`input[aria-label="${en.flexibleDuel.ratingDifferencePoints}"]`)).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await act(async () => searchButton().click())
    expect(mocks.search.mock.calls[1]![0].settings.maxRatingDifference).toBeNull()
  })
  it('does not show an unverified squad during or after an unfinished global check', async () => {
    let finish!: (value: unknown) => void
    mocks.search.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await render()
    await act(async () => searchButton().click())
    expect(container.querySelectorAll('li')).toHaveLength(0)
    await act(async () => finish({ options: [], status: 'UNKNOWN', scope: 'roster' }))
    expect(container.querySelectorAll('li')).toHaveLength(0)
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(en.flexibleDuel.notice.rosterLimited)
  })
  it('shows a focused server-error alert instead of an unexplained empty preview', async () => {
    mocks.search.mockRejectedValue(new Error('SOLVER_TIMEOUT'))
    await render()
    await act(async () => searchButton().click())
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain(en.flexibleDuel.fastErrors.SOLVER_TIMEOUT)
    expect(document.activeElement).toBe(alert)
    expect(generationButton().disabled).toBe(true)
  })
})

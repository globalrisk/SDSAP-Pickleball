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

const mocks = vi.hoisted(() => ({ search: vi.fn(), context: vi.fn(), save: vi.fn() }))
vi.mock('../context/LeagueContext', () => ({ useLeague: () => ({ league: { id: 'league' }, leaguePath: (path: string) => '/leagues/test' + path }) }))
vi.mock('../lib/leagueTeamDuelApi', () => ({ fetchFlexibleDuelContext: mocks.context, saveFlexibleDuelPlan: mocks.save }))
vi.mock('../lib/fastDuelApi', () => ({ requestFastDuel: vi.fn() }))
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
const generationButton = () => buttons().find(b => [en.flexibleDuel.generate, vietnamese.flexibleDuel.generate].includes(b.textContent!))!
const emptyResult = (status: string) => ({ status, provenInfeasibleSplitIds: [], totalSplits: 1716 })
const previewCard = () => container.querySelector('section[aria-label="Schedule preview"]')

function fixturePreview() {
  const squads: [PoolPlayer[], PoolPlayer[]] = [pool.slice(0, 7), pool.slice(7)]
  const games: LeagueDuelGame[] = skeletons['7'].map((g, i) => ({ roundNumber: g.round, sequenceNumber: i + 1,
    homePoolPlayerIds: g.home.map(p => squads[0][p]!.id) as [string, string], awayPoolPlayerIds: g.away.map(p => squads[1][p]!.id) as [string, string] }))
  const split = { id: 'verified', squads: squads.map(side => side.map(p => p.id)) as [string[], string[]] }
  const option = { id: duelScheduleId(games), kind: 'variety' as const, games, metrics: measureDuelSchedule(squads, games), solver: { status: 'FEASIBLE' as const, elapsedMs: 100 } }
  return { split, option }
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  scroll.mockClear(); mocks.search.mockReset(); mocks.context.mockResolvedValue(context); mocks.save.mockReset()
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
  it('shows a single unnamed preview and creates exactly its fixtures on confirmation', async () => {
    const preview = fixturePreview()
    mocks.search.mockResolvedValue({ ...emptyResult('FEASIBLE'), preview })
    mocks.save.mockResolvedValue({ count: 21, hash: 'saved' })
    await render()
    await act(async () => searchButton().click())
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('Your conditions can be met.')
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(0)
    expect(previewCard()?.textContent).toContain(en.flexibleDuel.solverFeasible)
    expect(container.textContent).not.toMatch(/More variety|Closest games|Refresh schedules/i)
    const generate = generationButton()
    expect(generate.disabled).toBe(false)
    expect(container.textContent).toContain('Player 13')
    expect(container.textContent).toContain('Opponents · 42/49 pairs')
    expect(container.textContent).toContain('Partners · 42/42 pairs')
    expect(container.textContent).toContain('Distinct partners per player · 6')
    const playerDetails = [...container.querySelectorAll('details li')].find(row => row.textContent?.startsWith('Player 13:'))
    expect(playerDetails?.textContent).toContain('6 distinct partners, 6 distinct opponents')
    expect(mocks.save).not.toHaveBeenCalled()
    await act(async () => generate.click())
    expect(mocks.save).toHaveBeenCalledWith(season.id, expect.objectContaining({ squads: preview.split.squads, option: preview.option }), expect.any(Array), 1, 'fp', null, true, expect.any(Array))
  })
  it('keeps the verified preview usable after an unfinished or cancelled shuffle', async () => {
    const preview = fixturePreview()
    mocks.search.mockResolvedValueOnce({ ...emptyResult('FEASIBLE'), preview }).mockResolvedValueOnce(emptyResult('UNKNOWN'))
    await render()
    await act(async () => searchButton().click())
    await act(async () => searchButton().click())
    expect(mocks.search.mock.calls[1]![2]).toMatchObject({ current: 'verified', seen: ['verified'] })
    expect(previewCard()).not.toBeNull()
    expect(generationButton().disabled).toBe(false)
    expect(container.textContent).toContain(en.flexibleDuel.notice.shuffleLimited)
    mocks.search.mockImplementation(() => new Promise(() => {}))
    await act(async () => searchButton().click())
    await act(async () => buttons().find(b => b.textContent === en.flexibleDuel.cancel)!.click())
    expect(mocks.search.mock.calls[2]![4].aborted).toBe(true)
    expect(previewCard()).not.toBeNull()
    expect(generationButton().disabled).toBe(false)
    expect(container.textContent).toContain(en.flexibleDuel.notice.shuffleCancelled)
  })
  for (const language of ['en', 'vi']) for (const status of ['INFEASIBLE', 'UNKNOWN']) it(`announces and focuses ${status} in ${language}, keeping generation disabled`, async () => {
    mocks.search.mockResolvedValue(emptyResult(status))
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
  for (const engine of ['cp-sat', 'exhaustive', undefined] as const) for (const kind of ['variety', 'balance'] as const) it(`restores only supported saved schedules (${engine}, ${kind})`, async () => {
    const squads: [PoolPlayer[], PoolPlayer[]] = [pool.slice(0, 7), pool.slice(7)]
    const games: LeagueDuelGame[] = skeletons['7'].map((g, i) => ({ roundNumber: g.round, sequenceNumber: i + 1,
      homePoolPlayerIds: g.home.map(p => squads[0][p]!.id) as [string, string], awayPoolPlayerIds: g.away.map(p => squads[1][p]!.id) as [string, string] }))
    // Historical CP-SAT plans omitted maxRatingDifference; treat them as unlimited.
    const settings = { maxPartnerMeetings: 2, maxOpponentMeetings: 2, maxMatchProbability: .65 }
    const plan: FlexibleDuelPlan = { version: 1, engine, inputKey: JSON.stringify([1, context.key, settings]), settings,
      splitId: 'saved', squads: squads.map(s => s.map(p => p.id)) as [string[], string[]],
      option: { id: duelScheduleId(games), kind, games, metrics: measureDuelSchedule(squads, games) } }
    await render('en', plan)
    const restorable = engine === 'cp-sat' && kind === 'variety'
    expect(Boolean(previewCard())).toBe(restorable)
    expect(container.textContent).not.toContain('Player experience')
    const gap = container.querySelector<HTMLSelectElement>(`select[aria-label="${en.flexibleDuel.maxRatingDifference}"]`)!
    expect(gap.value).toBe('none')
    if (restorable) {
      expect(container.textContent).toContain('Player details')
      await act(async () => { gap.value = 'limit'; gap.dispatchEvent(new Event('change', { bubbles: true })) })
      expect(previewCard()).toBeNull()
      expect(generationButton().disabled).toBe(true)
    } else {
      expect(container.textContent).toContain(en.flexibleDuel.notice.refreshDraft)
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
    mocks.search.mockResolvedValue(emptyResult('INFEASIBLE'))
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
    await act(async () => finish(emptyResult('UNKNOWN')))
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

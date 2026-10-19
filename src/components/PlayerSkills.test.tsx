import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { createInstance } from 'i18next'
import en from '../i18n/locales/en.json'
import vietnamese from '../i18n/locales/vi.json'
import { PLAYER_SKILLS, SKILL_GROUPS, type SkillGroup, type SkillSummary } from '../lib/playerSkills'
import { SkillRadarChart } from './SkillRadarChart'

const state = vi.hoisted(() => ({ summary: null as SkillSummary | null, error: false, pending: false, signedIn: false, eligible: true }))
vi.mock('../hooks/usePlayerSkills', () => ({ usePlayerSkills: () => ({
  summary: { data: state.summary, isPending: state.pending, isError: state.error, refetch: vi.fn() },
  mine: { data: { canRate: state.eligible, reason: state.eligible ? 'eligible' : 'self', scores: null }, isPending: false, isError: false },
  account: { data: { playerId: 'rater' }, isPending: false, isError: false },
  user: state.signedIn ? { id: 'user' } : null, authLoading: false, leagueId: 'league',
}) }))
import { PlayerSkills } from './PlayerSkills'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: en }, vi: { translation: vietnamese } }, interpolation: { escapeValue: false } })
const summary = (values: Partial<Record<typeof PLAYER_SKILLS[number], number>> = {}): SkillSummary => ({
  skills: Object.fromEntries(PLAYER_SKILLS.map(skill => [skill, { average: values[skill] ?? null, count: values[skill] == null ? 0 : 1 }])) as SkillSummary['skills'],
  raterCount: Object.keys(values).length ? 1 : 0,
  groupRaterCounts: Object.fromEntries(SKILL_GROUPS.map(group => [group.id, group.skills.some(skill => values[skill] != null) ? 1 : 0])) as SkillSummary['groupRaterCounts'],
})
const render = () => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><I18nextProvider i18n={i18n}><PlayerSkills playerId="target" /></I18nextProvider></QueryClientProvider>)
const chart = (data: SkillSummary, group: SkillGroup = SKILL_GROUPS[0]) => renderToStaticMarkup(<I18nextProvider i18n={i18n}><SkillRadarChart group={group} summary={data} /></I18nextProvider>)
beforeEach(async () => { state.summary = summary(); state.error = false; state.pending = false; state.signedIn = false; state.eligible = true; await i18n.changeLanguage('en') })

describe('Skill profile display and chart gaps', () => {
  it('renders an empty grid without a fabricated rating shape and includes accessible text', () => {
    const html = render()
    expect(html).toContain('No peer ratings yet')
    expect(html.match(/Not rated/g)).toHaveLength(18)
    expect(html.match(/role="img"/g)).toHaveLength(2)
    expect(html).toContain('Shot Skills')
    expect(html).toContain('Game Attributes')
    expect(html).toContain('About these attributes')
    expect(html).not.toContain('data-skill-shape')
    expect(html).not.toContain('data-skill-segment')
    expect(html).toContain('role="img"')
    expect(html).toContain('Sign in with a linked player account')
  })
  it('draws only adjacent known scores and preserves a real zero', () => {
    const html = chart(summary({ drive: 0, drop: 80, serve: 100, lob: 55 }))
    expect(html.match(/data-skill-segment/g)).toHaveLength(2)
    expect(html.match(/<circle/g)).toHaveLength(4)
    expect(html).not.toContain('data-skill-shape')
    expect(html).toContain('Drive: 0/100')
  })
  it('fills the polygon only when every skill has a score', () => {
    const data = summary(Object.fromEntries(SKILL_GROUPS[0].skills.map(skill => [skill, 75])))
    expect(chart(data)).toContain('data-skill-shape="complete"')
    expect(chart(data).match(/<circle/g)).toHaveLength(9)
    expect(chart(data, SKILL_GROUPS[1])).not.toContain('data-skill-shape')
    const attributes = summary(Object.fromEntries(SKILL_GROUPS[1].skills.map(skill => [skill, 80])))
    expect(chart(attributes, SKILL_GROUPS[1])).toContain('data-skill-shape="complete"')
    expect(chart(attributes, SKILL_GROUPS[1]).match(/<circle/g)).toHaveLength(9)
  })
  it('moves real footwork scores to Game Attributes and uses independent group counts', () => {
    state.summary = summary({ footwork: 0 })
    expect(chart(state.summary)).not.toContain('<circle')
    expect(chart(state.summary, SKILL_GROUPS[1])).toContain('Footwork: 0/100')
    expect(state.summary.groupRaterCounts).toEqual({ shots: 0, attributes: 1 })
    const html = render()
    expect(html).toContain('Positioning concerns where to be')
    expect(html).toContain('Soften an opponent')
  })
  it('renders translated counts and eligibility without allowing self-rating', async () => {
    state.signedIn = true
    expect(render()).toContain('Rate skills')
    state.eligible = false
    expect(render()).toContain('You cannot rate yourself')
    expect(render()).not.toContain('>Rate skills</button>')
    await i18n.changeLanguage('vi')
    expect(render()).toContain('Kỹ năng người chơi')
    expect(render()).toContain('0 lượt đánh giá')
    expect(render()).toContain('Kỹ thuật đánh bóng')
    expect(render()).toContain('Năng lực thi đấu')
    expect(render()).not.toContain('skills.')
    for (const skill of PLAYER_SKILLS) {
      expect(en.skills.names[skill]).toBeTruthy()
      expect(en.skills.descriptions[skill]).toBeTruthy()
      expect(vietnamese.skills.names[skill]).toBeTruthy()
      expect(vietnamese.skills.descriptions[skill]).toBeTruthy()
    }
  })
  it('offers a retry on loading errors and announces loading', () => {
    state.error = true
    expect(render()).toContain('Could not load skill scores')
    expect(render()).toContain('Try again')
    state.error = false; state.pending = true
    expect(render()).toContain('role="status"')
  })
})

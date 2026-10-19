import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { startLocalSupabase } from '../../scripts/test-support/local-supabase.mjs'
import { PLAYER_SKILLS, type SkillScores } from './playerSkills'

const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('./supabase', () => ({ supabase: { rpc: (name: string, args: Record<string, unknown>) => state.client!.rpc(name, args) } }))
import { fetchMySkillRating, fetchSkillSummary, removeSkillRating, saveSkillRating } from './playerSkillsApi'
import { linkPlayerAccount, unlinkPlayerAccount } from './betsApi'

let api: Awaited<ReturnType<typeof startLocalSupabase>>
let a: Awaited<ReturnType<typeof api.addAccount>>, b: typeof a, targetAccount: typeof a, unlinked: typeof a
let leagueId: string, target: string, raterA: string, raterB: string
const client = (token?: string) => createClient(api.url, 'local-anon-key', { global: { headers: token ? { Authorization: `Bearer ${token}` } : {} }, auth: { persistSession: false, autoRefreshToken: false } })
const scores = (values: Partial<SkillScores> = {}): SkillScores => ({ ...Object.fromEntries(PLAYER_SKILLS.map(skill => [skill, null])), ...values }) as SkillScores

beforeAll(async () => {
  api = await startLocalSupabase()
  leagueId = api.seeded!.leagueId
  ;[target, raterA, raterB] = api.seeded!.players.map(player => player.id) as [string, string, string]
  a = await api.addAccount({ email: 'skill-a@example.test' })
  b = await api.addAccount({ email: 'skill-b@example.test' })
  targetAccount = await api.addAccount({ email: 'skill-target@example.test' })
  unlinked = await api.addAccount({ email: 'skill-unlinked@example.test' })
  state.client = client(api.token)
  await linkPlayerAccount(raterA, a.email)
  await linkPlayerAccount(raterB, b.email)
  await linkPlayerAccount(target, targetAccount.email)
}, 20000)
beforeEach(async () => { await api.db.exec('DELETE FROM player_skills_private.ratings'); state.client = client(a.token) })
afterAll(async () => { await api?.close() })

describe('Peer skill ratings through SDK → HTTP → real PostgreSQL', () => {
  it('surfaces a failed save without changing scores and permits a retry', async () => {
    api.failNextSkillSave()
    const draft = scores({ drive: 77, drop: 64 })
    await expect(saveSkillRating(leagueId, target, draft)).rejects.toMatchObject({ code: '40001' })
    expect((await fetchSkillSummary(target)).raterCount).toBe(0)
    await saveSkillRating(leagueId, target, draft)
    expect((await fetchMySkillRating(leagueId, target)).scores).toEqual(draft)
  })
  it('averages only observed skills, replaces edits, isolates own votes, and removes votes', async () => {
    expect(await fetchMySkillRating(leagueId, target)).toMatchObject({ canRate: true, scores: null })
    expect((await fetchSkillSummary(target)).skills.drive).toEqual({ average: null, count: 0 })
    await saveSkillRating(leagueId, target, scores({ drive: 0, serve: 100, dink: 61 }))
    state.client = client(b.token)
    expect((await fetchMySkillRating(leagueId, target)).scores).toBeNull()
    await saveSkillRating(leagueId, target, scores({ drive: 100, dink: 60 }))
    const summary = await fetchSkillSummary(target)
    expect(summary.raterCount).toBe(2)
    expect(summary.skills.drive).toEqual({ average: 50, count: 2 })
    expect(summary.skills.serve).toEqual({ average: 100, count: 1 })
    expect(summary.skills.dink).toEqual({ average: 61, count: 2 })
    expect(summary.skills.drop).toEqual({ average: null, count: 0 })
    expect(Object.keys(summary).sort()).toEqual(['groupRaterCounts', 'raterCount', 'skills'])
    expect(summary.groupRaterCounts).toEqual({ shots: 2, attributes: 0 })
    state.client = client(a.token)
    expect((await fetchMySkillRating(leagueId, target)).scores?.drive).toBe(0)
    await saveSkillRating(leagueId, target, scores({ volley: 80 }))
    expect((await fetchSkillSummary(target)).skills.serve).toEqual({ average: null, count: 0 })
    await removeSkillRating(target)
    await removeSkillRating(target)
    expect((await fetchSkillSummary(target)).raterCount).toBe(1)
    state.client = client()
    expect((await fetchSkillSummary(target)).skills.drive.average).toBe(100)
    await expect(fetchMySkillRating(leagueId, target)).rejects.toMatchObject({ code: '42501' })
    await expect(saveSkillRating(leagueId, target, scores({ drive: 50 }))).rejects.toMatchObject({ code: '42501' })
    await expect(removeSkillRating(target)).rejects.toMatchObject({ code: '42501' })
  })

  it('supports ratings in either group and preserves new scores when an older client omits them', async () => {
    await saveSkillRating(leagueId, target, scores({ mental_game: 0, reset: 100, footwork: 86, game_iq: 75, overhead: 80 }))
    const legacyPayload = { drive: 70, drop: null, serve: null, dink: null, return: null, volley: null, lob: null, footwork: 90 }
    expect((await state.client!.rpc('save_player_skill_rating', { p_league_id: leagueId, p_player_id: target, p_scores: legacyPayload })).error).toBeNull()
    expect((await fetchMySkillRating(leagueId, target)).scores).toMatchObject({ drive: 70, footwork: 90, mental_game: 0, reset: 100, game_iq: 75, overhead: 80 })
    state.client = client(b.token)
    await saveSkillRating(leagueId, target, scores({ mental_game: 100, teamwork: 88 }))
    let summary = await fetchSkillSummary(target)
    expect(summary.raterCount).toBe(2)
    expect(summary.groupRaterCounts).toEqual({ shots: 1, attributes: 2 })
    expect(summary.skills.mental_game).toEqual({ average: 50, count: 2 })
    expect(summary.skills.stamina).toEqual({ average: null, count: 0 })
    state.client = client(a.token)
    await saveSkillRating(leagueId, target, scores({ reset: 40 }))
    expect((await fetchMySkillRating(leagueId, target)).scores).toEqual(scores({ reset: 40 }))
    summary = await fetchSkillSummary(target)
    expect(summary.groupRaterCounts).toEqual({ shots: 1, attributes: 1 })
    await removeSkillRating(target)
    summary = await fetchSkillSummary(target)
    expect(summary.groupRaterCounts).toEqual({ shots: 0, attributes: 1 })
    state.client = client(b.token)
    await removeSkillRating(target)
    expect((await fetchSkillSummary(target)).groupRaterCounts).toEqual({ shots: 0, attributes: 0 })
  })

  it('allows linked voters to rate, edit, and withdraw votes for recipients without accounts', async () => {
    const recipient = api.seeded!.players[4]!.id
    expect((await api.db.query('SELECT 1 FROM public.player_accounts WHERE pool_player_id=$1', [recipient])).rows).toHaveLength(0)
    expect(await fetchMySkillRating(leagueId, recipient)).toMatchObject({ canRate: true, reason: 'eligible', scores: null })
    await saveSkillRating(leagueId, recipient, scores({ reset: 0, mental_game: 100 }))
    await saveSkillRating(leagueId, recipient, scores({ reset: 75 }))
    expect((await fetchMySkillRating(leagueId, recipient)).scores).toEqual(scores({ reset: 75 }))
    expect((await fetchSkillSummary(recipient)).skills.reset).toEqual({ average: 75, count: 1 })
    state.client = client(unlinked.token)
    expect(await fetchMySkillRating(leagueId, recipient)).toMatchObject({ canRate: false, reason: 'unlinked', scores: null })
    await expect(saveSkillRating(leagueId, recipient, scores({ reset: 50 }))).rejects.toMatchObject({ code: '42501' })
    state.client = client()
    await expect(saveSkillRating(leagueId, recipient, scores({ reset: 50 }))).rejects.toMatchObject({ code: '42501' })
    expect((await fetchSkillSummary(recipient)).skills.reset).toEqual({ average: 75, count: 1 })
    state.client = client(a.token)
    await api.db.query("UPDATE public.league_players SET status='inactive' WHERE league_id=$1 AND pool_player_id=$2", [leagueId, recipient])
    expect((await fetchMySkillRating(leagueId, recipient)).reason).toBe('inactive')
    await expect(saveSkillRating(leagueId, recipient, scores({ reset: 80 }))).rejects.toMatchObject({ code: '42501' })
    await api.db.query("UPDATE public.league_players SET status='active' WHERE league_id=$1 AND pool_player_id=$2", [leagueId, recipient])
    await removeSkillRating(recipient)
    expect((await fetchSkillSummary(recipient)).raterCount).toBe(0)
  })

  it('rejects invalid submissions, self-rating, unlinked voters, and unrelated/inactive memberships', async () => {
    for (const payload of [{}, { drive: null }, { drive: -1 }, { drive: 101 }, { drive: 9.5 }, { drive: '50' }, { drive: true }, { unknown: 50 }, null, []]) {
      const result = await state.client!.rpc('save_player_skill_rating', { p_league_id: leagueId, p_player_id: target, p_scores: payload })
      expect(result.error?.message).toContain('SKILL_SCORES')
    }
    for (const skill of PLAYER_SKILLS) {
      for (const value of [-1, 101, 0.5, '50', true]) {
        const invalid = await state.client!.rpc('save_player_skill_rating', { p_league_id: leagueId, p_player_id: target, p_scores: { [skill]: value } })
        expect(invalid.error?.message).toContain('SKILL_SCORES')
      }
    }
    await expect(saveSkillRating(leagueId, raterA, scores({ serve: 100 }))).rejects.toMatchObject({ code: '42501' })
    state.client = client(unlinked.token)
    expect((await fetchMySkillRating(leagueId, target)).reason).toBe('unlinked')
    await expect(saveSkillRating(leagueId, target, scores({ serve: 100 }))).rejects.toMatchObject({ code: '42501' })
    state.client = client(a.token)
    await expect(saveSkillRating('11111111-1111-4111-8111-111111111111', target, scores({ drive: 50 }))).rejects.toMatchObject({ code: '42501' })
    for (const id of [raterA, target]) {
      await api.db.query("UPDATE public.league_players SET status='inactive' WHERE league_id=$1 AND pool_player_id=$2", [leagueId, id])
      expect((await fetchMySkillRating(leagueId, target)).reason).toBe('inactive')
      await expect(saveSkillRating(leagueId, target, scores({ drive: 50 }))).rejects.toMatchObject({ code: '42501' })
      await api.db.query("UPDATE public.league_players SET status='active' WHERE league_id=$1 AND pool_player_id=$2", [leagueId, id])
    }
    await api.db.query("UPDATE public.leagues SET status='archived' WHERE id=$1", [leagueId])
    await expect(saveSkillRating(leagueId, target, scores({ drive: 50 }))).rejects.toMatchObject({ code: '42501' })
    await api.db.query("UPDATE public.leagues SET status='active' WHERE id=$1", [leagueId])
    expect((await fetchSkillSummary(target)).raterCount).toBe(0)
    state.client = client(api.token)
    const adminPlayer = api.seeded!.players[3]!.id
    await linkPlayerAccount(adminPlayer, 'admin@example.test')
    await expect(saveSkillRating(leagueId, adminPlayer, scores({ drive: 100 }))).rejects.toMatchObject({ code: '42501' })
  })

  it('deduplicates retries and votes across leagues, including concurrent HTTP saves', async () => {
    const otherLeague = '11111111-1111-4111-8111-111111111111'
    await api.db.query('INSERT INTO public.league_players(league_id,pool_player_id) VALUES($1,$2),($1,$3)', [otherLeague, raterA, target])
    const payload = { p_league_id: leagueId, p_player_id: target, p_scores: scores({ drive: 71 }) }
    const results = await Promise.all([client(a.token).rpc('save_player_skill_rating', payload), client(a.token).rpc('save_player_skill_rating', { ...payload, p_league_id: otherLeague })])
    expect(results.every(result => result.error === null)).toBe(true)
    expect((await fetchSkillSummary(target)).raterCount).toBe(1)
    expect((await fetchMySkillRating(otherLeague, target)).scores?.drive).toBe(71)
    await saveSkillRating(otherLeague, target, scores({ drive: 99 }))
    expect((await fetchSkillSummary(target)).skills.drive).toEqual({ average: 99, count: 1 })
    expect((await api.db.query('SELECT count(*) AS n FROM player_skills_private.ratings')).rows[0]).toEqual({ n: 1 })
  })

  it('retains identity ratings through unlink/relink and immediately enforces current ownership', async () => {
    await saveSkillRating(leagueId, target, scores({ drop: 82 }))
    state.client = client(api.token)
    await unlinkPlayerAccount(target, targetAccount.email, crypto.randomUUID())
    state.client = client(a.token)
    expect(await fetchMySkillRating(leagueId, target)).toMatchObject({ canRate: true, reason: 'eligible' })
    expect((await fetchSkillSummary(target)).skills.drop.average).toBe(82)
    await saveSkillRating(leagueId, target, scores({ drop: 90 }))
    expect((await fetchSkillSummary(target)).skills.drop.average).toBe(90)
    state.client = client(api.token)
    await linkPlayerAccount(target, targetAccount.email)
    await unlinkPlayerAccount(raterA, a.email, crypto.randomUUID())
    state.client = client(a.token)
    expect((await fetchMySkillRating(leagueId, target)).scores).toBeNull()
    expect((await fetchMySkillRating(leagueId, target)).reason).toBe('unlinked')
    await expect(saveSkillRating(leagueId, target, scores({ drop: 100 }))).rejects.toMatchObject({ code: '42501' })
    await expect(removeSkillRating(target)).rejects.toMatchObject({ code: '42501' })
    state.client = client(api.token)
    await linkPlayerAccount(raterA, unlinked.email)
    state.client = client(unlinked.token)
    expect((await fetchMySkillRating(leagueId, target)).scores?.drop).toBe(90)
    await api.db.query("UPDATE public.league_players SET status='inactive' WHERE league_id=$1 AND pool_player_id=$2", [leagueId, raterA])
    await removeSkillRating(target)
    expect((await fetchSkillSummary(target)).raterCount).toBe(0)
  })
})

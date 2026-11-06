import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'vite'
import { startLocalSupabase } from './local-supabase.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.CODEX_BROWSER_PACKAGES ? `${process.env.CODEX_BROWSER_PACKAGES}/playwright` : 'playwright')
const api = await startLocalSupabase()
const engine = process.env.DUEL_SEARCH_ENGINE || 'exhaustive'
let python, solverUrl
if (engine === 'cp-sat') {
  python = spawn(process.env.DUEL_CPSAT_PYTHON || 'python', ['scripts/test-support/duel-solver-server.py'], { env: { ...process.env, VITE_SUPABASE_URL: api.url, VITE_SUPABASE_ANON_KEY: 'local-anon-key' }, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] })
  solverUrl = await new Promise((resolve, reject) => { python.once('error', reject); python.stdout.once('data', chunk => resolve(JSON.parse(String(chunk).trim()).url)) })
}
process.env.VITE_SUPABASE_URL = api.url
process.env.VITE_SUPABASE_ANON_KEY = 'local-anon-key'
const vite = await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true, proxy: solverUrl ? { '/api/duel-solve': solverUrl } : undefined } })
let browser
try {
  const { supabase } = await vite.ssrLoadModule('/src/lib/supabase.ts')
  const login = await supabase.auth.signInWithPassword({ email: 'admin@example.test', password: 'local-test-password' })
  if (login.error) throw login.error
  const duel = await vite.ssrLoadModule('/src/lib/leagueTeamDuelApi.ts')
  const { saveSeasonRoster } = await vite.ssrLoadModule('/src/lib/seasonRosterApi.ts')
  const { seasonId, leagueId, players } = api.seeded
  await duel.setSeasonFormat(seasonId, 'team_duel')
  await saveSeasonRoster(seasonId, players.slice(0, 8).map(p => p.id))
  await api.db.query('UPDATE public.league_players SET rating=1500,rating_deviation=90 WHERE league_id=$1', [leagueId])
  if (engine === 'cp-sat') {
    assert.equal((await fetch(solverUrl + '/api/duel-solve')).status, 200)
    assert.equal((await fetch(solverUrl + '/api/duel-solve', { method: 'POST', body: '{}' })).status, 401)
    const player = await api.addAccount({ email: 'solver-player@example.test' })
    assert.equal((await fetch(solverUrl + '/api/duel-solve', { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${player.token}` } })).status, 403)
  }
  await vite.listen()
  browser = await chromium.launch({ headless: true, executablePath: process.env.DUEL_BROWSER_EXECUTABLE, channel: process.env.DUEL_BROWSER_EXECUTABLE ? undefined : process.env.DUEL_BROWSER_CHANNEL || 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  page.setDefaultTimeout(30000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('sdsap-lang', 'en'))
  await page.goto('http://127.0.0.1:5174/leagues/duel-verification/login')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.locator('input[autocomplete="username"]').fill('admin@example.test')
  await page.locator('input[type="password"]').fill('local-test-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('**/setup')
  const setup = 'http://127.0.0.1:5174/leagues/duel-verification/setup?section=teams'
  await page.goto(setup)
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.getByLabel('Scheduling mode', { exact: true }).selectOption(engine)
  const partner = page.getByLabel('Maximum games with the same partner', { exact: true })
  const opponent = page.getByLabel('Maximum games against the same opponent', { exact: true })
  await partner.waitFor()
  assert.equal(await partner.inputValue(), '2')
  assert.equal(await opponent.inputValue(), '3')
  await opponent.selectOption('2')
  assert.equal(await opponent.locator('option[value="1"]').evaluate(o => o.disabled), true)
  const radios = page.locator('input[type="radio"][name^="duel-"]')
  const save = page.getByRole('button', { name: 'Save selected squads', exact: true })
  const generate = page.getByRole('button', { name: 'Generate 6 selected matches', exact: true })
  async function ready() {
    await page.waitForFunction(() => document.querySelectorAll('input[type="radio"][name^="duel-"]:not(:disabled)').length === 3)
    assert.equal(await page.getByLabel('Season win chances', { exact: true }).count(), 3)
  }
  const probability = page.getByLabel('Maximum match win probability (%)', { exact: true })
  assert.equal(await probability.inputValue(), '65')
  await probability.fill('49')
  assert.equal(await page.getByRole('button', { name: 'Search squads and schedules', exact: true }).isDisabled(), true)
  await probability.fill('65')
  if (engine === 'cp-sat') {
    const messages = JSON.parse(await readFile('src/i18n/locales/en.json', 'utf8')).flexibleDuel.notice
    const ids = players.slice(0, 8).map(p => p.id).sort()
    const splits = []
    for (let a = 1; a < 6; a++) for (let b = a + 1; b < 7; b++) for (let c = b + 1; c < 8; c++) {
      const home = [ids[0], ids[a], ids[b], ids[c]]
      splits.push(home.join(':') + '|' + ids.filter(id => !home.includes(id)).join(':'))
    }
    for (const [status, message] of [
      ['INFEASIBLE', messages.noValid],
      ['UNKNOWN', messages.rosterLimited],
    ]) {
      await page.route('**/api/duel-solve', route => route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', result: { options: [], status, scope: 'roster', totalSplits: 35, provenInfeasibleSplitIds: status === 'INFEASIBLE' ? splits : [] } }) + '\n' }))
      await page.getByRole('button', { name: /^(Search squads and schedules|Shuffle squads|Continue checking conditions)$/ }).click()
      await page.getByText(message, { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Generate 0 selected matches', exact: true }).isDisabled(), true)
      await page.unroute('**/api/duel-solve')
      await probability.fill('70')
      await page.getByRole('button', { name: 'Search squads and schedules', exact: true }).waitFor()
      await probability.fill('65')
    }
    await probability.fill('70')
    await page.getByRole('button', { name: 'Search squads and schedules', exact: true }).waitFor()
    await probability.fill('65')
  }
  await page.getByRole('button', { name: 'Search squads and schedules', exact: true }).click()
  await ready()
  // Editing the hard ceiling invalidates previews and generation immediately.
  await probability.fill('60')
  await page.getByRole('button', { name: 'Generate 0 selected matches', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Generate 0 selected matches', exact: true }).isDisabled(), true)
  await probability.fill('65')
  await page.getByRole('button', { name: 'Search squads and schedules', exact: true }).click()
  await ready()
  const names = page.getByRole('textbox', { name: /^Squad [AB] name$/ })
  await names.nth(0).fill('Local Alpha')
  await names.nth(1).fill('Local Beta')
  await radios.nth(1).check()
  await page.getByText('Inspect matches, counts, and player difficulty', { exact: true }).click()
  assert.equal(await page.locator('details table').count(), 4)
  await mkdir('artifacts.local/flexible-duel', { recursive: true })
  await page.screenshot({ path: 'artifacts.local/flexible-duel/desktop.png', fullPage: true })
  await save.click()
  await page.getByText('The selected squads, limits, and exact schedule were saved.', { exact: true }).waitFor()
  const row = () => api.db.query('SELECT duel_draft_plan,duel_draft_plan_hash FROM public.seasons WHERE id=$1', [seasonId]).then(r => r.rows[0])
  const saved = await row()
  assert.equal(saved.duel_draft_plan.option.kind, 'variety')
  assert.equal(saved.duel_draft_plan.settings.maxMatchProbability, .65)
  assert.ok(saved.duel_draft_plan.option.metrics.worstFavorite <= .65 + 1e-12)
  await page.reload()
  await generate.waitFor()
  await page.waitForFunction(() => document.querySelectorAll('input[type="radio"][name^="duel-"]:checked').length === 1)
  assert.deepEqual((await row()).duel_draft_plan, saved.duel_draft_plan)
  assert.equal(await probability.inputValue(), '65')
  assert.equal(await names.nth(0).inputValue(), 'Local Alpha')
  await page.getByRole('button', { name: engine === 'cp-sat' ? 'Shuffle squads' : 'Search squads and schedules', exact: true }).click()
  await ready()
  await page.getByRole('button', { name: 'Refresh schedules', exact: true }).click()
  await ready()
  assert.equal(await names.nth(0).inputValue(), 'Local Alpha')
  await page.getByRole('button', { name: 'Shuffle squads', exact: true }).click()
  await ready()
  assert.equal(await partner.inputValue(), '2')
  assert.equal(await names.nth(1).inputValue(), 'Local Beta')
  // The worker must stop immediately when the settings change.
  await partner.selectOption('1')
  assert.equal(await page.getByRole('button', { name: 'Generate 0 selected matches', exact: true }).isEnabled(), false)
  await page.getByRole('button', { name: 'Search squads and schedules', exact: true }).click()
  await ready()
  // A changed rating snapshot must reject the old preview, preserving storage.
  await api.db.query('UPDATE public.league_players SET rating=rating+1 WHERE league_id=$1 AND pool_player_id=$2', [leagueId, players[0].id])
  await generate.click()
  await page.getByText('Ratings or roster changed. Run a fresh search before saving.', { exact: true }).waitFor()
  assert.equal((await api.db.query('SELECT count(*)::int n FROM public.matches WHERE season_id=$1', [seasonId])).rows[0].n, 0)
  await page.getByRole('button', { name: 'Search squads and schedules', exact: true }).click()
  await ready()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'VI', exact: true }).click()
  await page.screenshot({ path: 'artifacts.local/flexible-duel/mobile-vi.png', fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile page overflows')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await generate.click()
  await page.getByText('Saved limits: partner 1; opponent 2.', { exact: true }).waitFor()
  const final = await row()
  const matches = (await api.db.query('SELECT round_number,duel_sequence_number,home_pool_player_ids,away_pool_player_ids FROM public.matches WHERE season_id=$1 ORDER BY duel_sequence_number', [seasonId])).rows
  assert.deepEqual(matches.map(m => ({ roundNumber: m.round_number, sequenceNumber: m.duel_sequence_number, homePoolPlayerIds: m.home_pool_player_ids, awayPoolPlayerIds: m.away_pool_player_ids })), final.duel_draft_plan.option.games)
  const fixtureIds = (await api.db.query('SELECT id FROM public.matches WHERE season_id=$1', [seasonId])).rows.map(m => m.id)
  await duel.clearUnplayedLeagueDuelFixtures(seasonId, fixtureIds)
  await saveSeasonRoster(seasonId, players.map(p => p.id))
  await page.goto(setup)
  await page.getByLabel('Scheduling mode', { exact: true }).selectOption(engine)
  await page.getByRole('button', { name: 'Search squads and schedules', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel search', exact: true }).click()
  await page.getByText('Search cancelled. Start again before saving or generating.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /^Generate \d+ selected matches$/ }).isDisabled(), true)
  await page.getByRole('button', { name: engine === 'cp-sat' ? 'Shuffle squads' : 'Search squads and schedules', exact: true }).click()
  await page.goto('http://127.0.0.1:5174/leagues/duel-verification/matches')
  assert.equal((await api.db.query('SELECT count(*)::int n FROM public.matches WHERE season_id=$1', [seasonId])).rows[0].n, 0)
  assert.deepEqual(errors, [])
  console.log(`PASS browser (${engine}): real search, three options, filters, shuffle/refresh, detail matrices, exact save/reload/generate, stale rejection, cancellation/navigation, English/Vietnamese, mobile layout`)
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]
  if (page) console.error((await page.locator('body').innerText()).slice(0, 6000))
  throw error
} finally {
  await browser?.close()
  await vite.close()
  await api.close()
  python?.kill()
}

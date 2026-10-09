import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import { startLocalSupabase } from './local-supabase.mjs'

// Use installed Playwright, or the desktop bundle supplied through this variable.
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.CODEX_BROWSER_PACKAGES ? `${process.env.CODEX_BROWSER_PACKAGES}/playwright` : 'playwright')
const priority = process.env.DUEL_DRAFT_PRIORITY || 'opponent_variety'
assert.ok(['balance', 'opponent_variety'].includes(priority))
const selectedIndex = priority === 'balance' ? 0 : 1
const api = await startLocalSupabase()
process.env.VITE_SUPABASE_URL = api.url
process.env.VITE_SUPABASE_ANON_KEY = 'local-anon-key'
const vite = await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true } })
let browser
try {
  const { supabase } = await vite.ssrLoadModule('/src/lib/supabase.ts')
  const login = await supabase.auth.signInWithPassword({ email: 'admin@example.test', password: 'local-test-password' })
  if (login.error) throw login.error
  const duel = await vite.ssrLoadModule('/src/lib/leagueTeamDuelApi.ts')
  const { season14DraftSnapshot } = await vite.ssrLoadModule('/src/lib/testFixtures/season14DraftSnapshot.ts')
  const { isSeasonForecastBalanced } = await vite.ssrLoadModule('/src/lib/seasonForecast.ts')
  const { saveSeasonRoster } = await vite.ssrLoadModule('/src/lib/seasonRosterApi.ts')
  const { leagueId, seasonId, players } = api.seeded
  async function restoreRatings() {
    for (let i = 0; i < players.length; i++) await api.db.query(
      'UPDATE public.league_players SET rating = $1, rating_deviation = $2 WHERE league_id = $3 AND pool_player_id = $4',
      [season14DraftSnapshot.ratings[i].rating, season14DraftSnapshot.ratings[i].rd, leagueId, players[i].id])
  }
  await restoreRatings()
  await duel.setSeasonFormat(seasonId, 'team_duel')
  await vite.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.DUEL_BROWSER_CHANNEL || 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('sdsap-lang', 'en'))
  await page.goto('http://127.0.0.1:5174/leagues/duel-verification/login')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.locator('input[autocomplete="username"]').fill('admin@example.test')
  await page.locator('input[type="password"]').fill('local-test-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('**/setup')
  await page.goto('http://127.0.0.1:5174/leagues/duel-verification/setup?section=teams')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  const radios = page.locator('input[name="duel-draft"]')
  await radios.first().waitFor()
  assert.equal(await radios.count(), 2)
  assert.equal(await page.getByLabel('Season win chances', { exact: true }).count(), 2)
  await page.getByText('Opponent meeting limits per player: top 4, middle 3, bottom 4. Each opponent pair must respect both players’ limits.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'VI', exact: true }).click()
  await page.getByText('Giới hạn gặp cùng một đối thủ cho mỗi người: nhóm trên 4, nhóm giữa 3, nhóm dưới 4. Mỗi cặp đối thủ phải tuân thủ giới hạn của cả hai người.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await radios.nth(selectedIndex).check()
  const names = page.getByRole('textbox', { name: /^Squad [AB] name$/ })
  await names.nth(0).fill('Local Alpha')
  await names.nth(1).fill('Local Beta')
  const ids = () => radios.evaluateAll((nodes) => nodes.map((node) => node.value))
  async function checkDraftBounds() {
    const preview = await duel.fetchLeagueDuelDraftPreview(leagueId, seasonId, [])
    const shown = await ids()
    for (const [i, mode] of ['balance', 'opponent_variety'].entries()) {
      const draft = preview.candidates[mode].find(draft => draft.id === shown[i])
      assert.ok(draft, 'shown card is outside the current quality pool')
      assert.ok(isSeasonForecastBalanced(draft.schedule.seasonForecast), 'shown card exceeds 55/45')
    }
  }
  await checkDraftBounds()
  // A changed rating snapshot can make both pools empty. Keep two disabled
  // choices, explain the limit in both languages, and preserve entered names.
  await api.db.query('UPDATE public.league_players SET rating=800, rating_deviation=20 WHERE league_id=$1', [leagueId])
  await api.db.query('UPDATE public.league_players SET rating=5000 WHERE league_id=$1 AND pool_player_id=$2', [leagueId, players[0].id])
  await page.getByRole('button', { name: 'Refresh draft options' }).click()
  await page.getByText(/No draft meets 55\/45/).first().waitFor()
  assert.equal(await page.getByText(/No draft meets 55\/45/).count(), 2)
  assert.equal(await radios.count(), 2)
  assert.equal(await radios.nth(0).isDisabled(), true)
  assert.equal(await radios.nth(1).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Save selected squads' }).isDisabled(), true)
  assert.equal(await page.getByLabel('Season win chances', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'VI', exact: true }).click()
  assert.equal(await page.getByText(/Không có phương án đạt 55\/45/).count(), 2)
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  // Even schedules show the conditional comparison as well as joint champions.
  await api.db.query('UPDATE public.league_players SET rating=1500, rating_deviation=100 WHERE league_id=$1', [leagueId])
  await saveSeasonRoster(seasonId, players.slice(0, 8).map(player => player.id))
  await page.getByRole('button', { name: 'Refresh draft options' }).click()
  await page.getByText(/Excluding joint champions:/).first().waitFor()
  assert.equal(await page.getByText(/Excluding joint champions:/).count(), 2)
  assert.equal(await page.getByText(/Joint champions:/).count(), 2)
  await checkDraftBounds()
  assert.equal(await radios.nth(selectedIndex).isChecked(), true, 'priority was lost across an empty pool')
  assert.equal(await names.nth(0).inputValue(), 'Local Alpha')
  assert.equal(await names.nth(1).inputValue(), 'Local Beta')
  await restoreRatings()
  await saveSeasonRoster(seasonId, players.map(player => player.id))
  await page.getByRole('button', { name: 'Refresh draft options' }).click()
  await page.waitForFunction(() => !document.body.textContent.includes('Excluding joint champions:') && [...document.querySelectorAll('button')].some(button => button.textContent === 'Save selected squads' && !button.disabled))
  await checkDraftBounds()
  const initial = await ids()
  const historyResponse = page.waitForResponse((response) => response.url().endsWith('/rpc/league_duel_partner_history'))
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await historyResponse
  await page.getByRole('button', { name: 'Refresh draft options' }).waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === 'Refresh draft options' && !button.disabled))
  assert.deepEqual(await ids(), initial, 'background refetch rotated options')
  await page.getByRole('button', { name: 'Refresh draft options' }).click()
  await page.waitForFunction((old) => [...document.querySelectorAll('input[name="duel-draft"]')].every((node, i) => node.value !== old[i]), initial)
  assert.equal(await radios.nth(selectedIndex).isChecked(), true)
  assert.equal(await names.nth(0).inputValue(), 'Local Alpha')
  assert.equal(await names.nth(1).inputValue(), 'Local Beta')
  await checkDraftBounds()
  assert.equal((await api.db.query('SELECT count(*)::integer count FROM public.teams WHERE season_id=$1', [seasonId])).rows[0].count, 0)
  const beforeFailure = await ids()
  const failingUrl = `${api.url}/rest/v1/rpc/league_duel_partner_history`
  await page.route(failingUrl, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Refresh test failure' }) }))
  await page.getByRole('button', { name: 'Refresh draft options' }).click()
  await page.getByText('Refresh test failure', { exact: true }).waitFor({ timeout: 20000 })
  assert.deepEqual(await ids(), beforeFailure, 'failed refresh removed cards')
  assert.equal(await page.getByRole('button', { name: 'Save selected squads' }).isDisabled(), true)
  await page.unroute(failingUrl)
  await page.getByRole('button', { name: 'Refresh draft options' }).click()
  await page.getByRole('button', { name: 'Save selected squads' }).waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === 'Save selected squads' && !button.disabled))
  await page.getByRole('button', { name: 'Save selected squads' }).click()
  const generate = page.getByRole('button', { name: /Generate Team Duel games/ })
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent.includes('Generate Team Duel games') && !button.disabled))
  const savedId = await page.locator('input[name="duel-draft"]:checked').inputValue()
  await page.reload()
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await page.waitForFunction((id) => document.querySelector('input[name="duel-draft"]:checked')?.value === id, savedId)
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent.includes('Generate Team Duel games') && !button.disabled))
  await generate.click()
  await page.getByText('Squad membership, ranks, tiers, and game lineups are frozen for this season.', { exact: true }).waitFor()
  assert.equal((await api.db.query('SELECT count(*)::integer count FROM public.matches WHERE season_id=$1', [seasonId])).rows[0].count, 21)
  assert.equal((await api.db.query('SELECT duel_draft_priority FROM public.seasons WHERE id=$1', [seasonId])).rows[0].duel_draft_priority, priority)
  const meetings = (await api.db.query(`SELECT h.id home, a.id away, h.duel_tier home_tier, a.duel_tier away_tier, count(*)::integer meetings
    FROM public.matches m CROSS JOIN LATERAL unnest(m.home_pool_player_ids) hp(id)
    CROSS JOIN LATERAL unnest(m.away_pool_player_ids) ap(id)
    JOIN public.players h ON h.season_id=m.season_id AND h.pool_player_id=hp.id
    JOIN public.players a ON a.season_id=m.season_id AND a.pool_player_id=ap.id
    WHERE m.season_id=$1 GROUP BY h.id,a.id,h.duel_tier,a.duel_tier`, [seasonId])).rows
  for (const pair of meetings) assert.ok(pair.meetings <= (pair.home_tier === 'middle' || pair.away_tier === 'middle' ? 3 : 4), 'generated games violate tier opponent limits')
  const app = await vite.ssrLoadModule('/src/lib/api.ts')
  const { forecastLeagueDuelSeason } = await vite.ssrLoadModule('/src/lib/seasonForecast.ts')
  const savedTeams = await app.fetchTeams(seasonId)
  const teamIds = savedTeams.map(team => team.id)
  async function checkForecast(path, remaining) {
    const fixtures = await app.fetchMatches(seasonId, leagueId)
    const expected = forecastLeagueDuelSeason(fixtures, teamIds)
    assert.ok(expected)
    await page.goto(`http://127.0.0.1:5174/leagues/duel-verification/${path}`)
    await page.getByRole('button', { name: 'EN', exact: true }).click()
    const summary = page.getByLabel('Season win chances', { exact: true })
    await summary.getByText(`${savedTeams[0].name} ${(expected.homeWinProbability * 100).toFixed(1)}% · ${savedTeams[1].name} ${(expected.awayWinProbability * 100).toFixed(1)}%`, { exact: true }).waitFor()
    await summary.getByText(`Expected game wins: ${savedTeams[0].name} ${expected.expectedHomeWins.toFixed(1)} · ${savedTeams[1].name} ${expected.expectedAwayWins.toFixed(1)}`, { exact: true }).waitFor()
    await summary.getByText(`All 21 games · ${remaining} remaining; recorded results are fixed.`, { exact: true }).waitFor()
    assert.equal(await page.getByText('Popcorn match', { exact: true }).count(), 0, 'closest-match forecast is still shown for Team Duel')
    assert.equal(await summary.getByText(/Joint champions:/).count(), 0)
    return fixtures
  }
  const fixtures = await checkForecast('', 21)
  assert.ok(isSeasonForecastBalanced(forecastLeagueDuelSeason(fixtures, teamIds)), 'generated fixtures exceed 55/45 before play')
  await checkForecast('matches', 21)
  await app.recordForfeit(fixtures[0].id, fixtures[0].home_team_id, fixtures[0].home_team_id, fixtures[0].away_team_id)
  await checkForecast('matches', 20)
  await page.getByRole('button', { name: 'VI', exact: true }).click()
  await page.getByLabel('Xác suất thắng cả mùa', { exact: true }).getByText('Toàn bộ 21 trận · còn 20 trận; kết quả đã ghi được giữ cố định.', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(`PASS browser (${priority}): 55/45 on initial/refresh/generated drafts, empty pools, even-season ties, preserved names/priority, draft/save/reload/generate, all-game forecast and fixed forfeit, English/Vietnamese`)
} finally {
  await browser?.close()
  await vite.close()
  await api.close()
}

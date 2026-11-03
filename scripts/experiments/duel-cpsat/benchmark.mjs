import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { createServer } from 'vite'

const { values } = parseArgs({ options: {
  python: { type: 'string', default: process.env.DUEL_CPSAT_PYTHON || 'python' },
  seconds: { type: 'string', default: '15' },
  'baseline-seconds': { type: 'string', default: '10' },
  case: { type: 'string', multiple: true },
} })
const seconds = Number(values.seconds), baselineSeconds = Number(values['baseline-seconds'])
assert.ok(Number.isFinite(seconds) && seconds > 0 && Number.isFinite(baselineSeconds) && baselineSeconds > 0)
const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false } })
let python
const results = []
try {
  const { teamWinProbability } = await vite.ssrLoadModule('/src/lib/ratings.ts')
  const { measureDuelSchedule, orderDuelGames } = await vite.ssrLoadModule('/src/lib/flexibleDuel.ts')
  const { isSeasonForecastBalanced, decisiveSeasonChances } = await vite.ssrLoadModule('/src/lib/seasonForecast.ts')
  const { flexibleDuelSearchSnapshot: reference } = await vite.ssrLoadModule('/src/lib/testFixtures/flexibleDuelSearchSnapshot.ts')
  const player = ([rating, rd], i) => ({ id: `p${String(i).padStart(2, '0')}`, name: `Player ${i}`, rating, rating_deviation: rd, initial_rating: rating, volatility: 0, status: 'active', created_at: '' })
  const equal = n => Array.from({ length: n }, (_, i) => player([1500, 90], i))
  const pool12 = reference.ratings.map(player)
  const pool14 = [...reference.ratings, [1550, 100], [1250, 100]].map(player).sort((a, b) => b.rating - a.rating)
  function similarTotals(pool) {
    const n = pool.length / 2, total = pool.reduce((s, p) => s + p.rating, 0)
    let best, gap = Infinity
    function visit(start, side) {
      if (side.length === n) { const d = Math.abs(2 * side.reduce((s, i) => s + pool[i].rating, 0) - total); if (d < gap) { gap = d; best = [...side] }; return }
      for (let i = start; i <= pool.length - n + side.length; i++) visit(i + 1, [...side, i])
    }
    visit(1, [0]); return [best.map(i => pool[i]), pool.filter((_, i) => !best.includes(i))]
  }
  const make = (name, squads, settings = { maxPartnerMeetings: 2, maxOpponentMeetings: 2 }, extras = {}) => ({ name, squads, settings, ...extras })
  const cases = [
    make('equal-14-one-thread', [equal(14).slice(0, 7), equal(14).slice(7)], undefined, { baseline: true }),
    make('equal-14-eight-threads', [equal(14).slice(0, 7), equal(14).slice(7)], undefined, { workers: 8 }),
    make('mixed-14-one-thread', similarTotals(pool14)),
    make('mixed-14-eight-threads', similarTotals(pool14), undefined, { workers: 8 }),
    make('mixed-14-bounded-one-thread', similarTotals(pool14), undefined, { maxWorst: .7 }),
    make('mixed-14-bounded-eight-threads', similarTotals(pool14), undefined, { workers: 8, maxWorst: .7 }),
    make('audited-12-one-thread', reference.splits[0].squads.map(side => side.map(i => pool12[i])), undefined, { maxWorst: reference.globalBest, expectedWorst: reference.globalBest }),
    make('below-audited-12-optimum', reference.splits[0].squads.map(side => side.map(i => pool12[i])), undefined, { maxWorst: reference.globalBest - 1e-8, expectedStatus: 'INFEASIBLE' }),
    make('odd-10-partner-once', [equal(10).slice(0, 5), equal(10).slice(5)], { maxPartnerMeetings: 1, maxOpponentMeetings: null }),
    make('even-8-partner-once', [equal(8).slice(0, 4), equal(8).slice(4)], { maxPartnerMeetings: 1, maxOpponentMeetings: null }),
    make('impossible-opponent-cap', [equal(8).slice(0, 4), equal(8).slice(4)], { maxPartnerMeetings: 2, maxOpponentMeetings: 1 }, { expectedStatus: 'INFEASIBLE' }),
    make('season-guard-no-valid-schedule', [equal(8).slice(0, 4), equal(8).slice(4)], undefined,
      { testProbabilities: Array(36).fill(.9), seconds: .8, expectedNoSolution: true }),
  ]
  python = spawn(values.python, [fileURLToPath(new URL('./solver.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
  let output = '', pending
  python.stdout.on('data', chunk => { output += chunk; let index; while ((index = output.indexOf('\n')) >= 0) { const line = output.slice(0, index); output = output.slice(index + 1); const request = pending; pending = null; try { request?.resolve(JSON.parse(line)) } catch (error) { request?.reject(error) } } })
  python.on('error', error => pending?.reject(error))
  python.on('exit', code => { if (pending) pending.reject(new Error(`CP-SAT process exited (${code})`)) })
  const solve = request => new Promise((resolve, reject) => { pending = { resolve, reject }; python.stdin.write(JSON.stringify(request) + '\n') })
  await mkdir('artifacts.local/duel-cpsat', { recursive: true })
  for (const test of cases.filter(test => !values.case || values.case.includes(test.name))) {
    const n = test.squads[0].length, edges = []
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) edges.push([a, b])
    const skill = (side, pair) => pair.map(i => ({ rating: test.squads[side][i].rating, rd: test.squads[side][i].rating_deviation, volatility: 0 }))
    const probabilities = test.testProbabilities ?? edges.flatMap(h => edges.map(a => teamWinProbability(skill(0, h), skill(1, a))))
    const result = await solve({ name: test.name, size: n, settings: test.settings, probabilities, seconds: test.seconds ?? seconds, workers: test.workers ?? 1, maxWorst: test.maxWorst ?? 1 })
    result.maxWorst = test.maxWorst ?? 1
    assert.equal(result.optimal, result.status === 'OPTIMAL')
    if (test.expectedStatus) {
      if (result.status === 'UNKNOWN') result.referenceCheck = 'UNKNOWN_WITHIN_BUDGET'
      else assert.equal(result.status, test.expectedStatus)
    }
    if (test.expectedNoSolution) { assert.equal(result.solution, null); assert.equal(result.optimal, false); assert.ok(result.rejectedForSeasonBalance > 0) }
    if (result.solution) {
      const games = result.solution.games.map((g, i) => ({ roundNumber: g.round, sequenceNumber: i + 1, homePoolPlayerIds: g.home.map(p => test.squads[0][p].id), awayPoolPlayerIds: g.away.map(p => test.squads[1][p].id) }))
      assert.equal(games.length, n * (n - 1) / 2)
      for (const r of new Set(games.map(g => g.roundNumber))) {
        const participants = games.filter(g => g.roundNumber === r).flatMap(g => [...g.homePoolPlayerIds, ...g.awayPoolPlayerIds])
        assert.equal(participants.length, Math.floor(n / 2) * 4)
        assert.equal(new Set(participants).size, participants.length)
      }
      const metrics = measureDuelSchedule(test.squads, games)
      assert.ok(metrics.players.every(p => p.games === n - 1))
      assert.ok(metrics.maxPartnerMeetings <= (test.settings.maxPartnerMeetings ?? n - 1))
      assert.ok(metrics.maxOpponentMeetings <= (test.settings.maxOpponentMeetings ?? n - 1))
      assert.ok(isSeasonForecastBalanced(metrics.forecast))
      assert.ok(Math.abs(metrics.worstFavorite - result.solution.worstFavorite) < 1e-12)
      assert.ok(Math.abs(decisiveSeasonChances(metrics.forecast).home - result.solution.forecast.decisiveHome) < 1e-12)
      if (test.expectedWorst) assert.ok(Math.abs(metrics.worstFavorite - test.expectedWorst) < 1e-12)
      result.validatedByApplication = true
      result.solution.orderedGames = orderDuelGames(games)
    } else if (!test.expectedNoSolution && !test.expectedStatus) assert.equal(result.status, 'UNKNOWN')
    if (test.baseline) {
      const baseline = new Worker(new URL('./baseline-worker.mjs', import.meta.url), { workerData: { squads: test.squads, settings: test.settings, upper: 1 } })
      result.baseline = await new Promise((resolve, reject) => {
        let timer
        baseline.on('error', error => { clearTimeout(timer); reject(error) })
        baseline.on('message', message => {
          if (message.type === 'ready') { const started = performance.now(); timer = setTimeout(() => resolve({ status: 'TIME_LIMIT', elapsedMs: performance.now() - started, limitSeconds: baselineSeconds }), baselineSeconds * 1000); baseline.postMessage('go') }
          else if (message.type === 'result') { clearTimeout(timer); resolve({ status: message.games ? 'FEASIBLE' : 'INFEASIBLE', elapsedMs: message.elapsedMs }) }
          else if (message.type === 'error') { clearTimeout(timer); reject(new Error(message.message)) }
        })
      })
      await baseline.terminate()
    }
    results.push(result)
    await writeFile('artifacts.local/duel-cpsat/results.json', JSON.stringify({ recordedAt: new Date().toISOString(), scope: 'Fixed-squad worst-match optimization, not global squad selection or all three ranking profiles', results }, null, 2))
    console.log(JSON.stringify({ ...result, solution: result.solution ? { worstFavorite: result.solution.worstFavorite, forecast: result.solution.forecast } : null }))
  }
} finally { python?.stdin.end(); python?.kill(); await vite.close() }

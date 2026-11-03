import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { createServer } from 'vite'

// Offline, anonymous input. Never reads from Supabase or creates any matches.
const vite = await createServer({ server: { middlewareMode: true } })
try {
  const { searchDuelSplits, searchDuelOptions } = await vite.ssrLoadModule('/src/lib/flexibleDuel.ts')
  const { flexibleDuelSearchSnapshot: reference } = await vite.ssrLoadModule('/src/lib/testFixtures/flexibleDuelSearchSnapshot.ts')
  const id = i => `p${String(i).padStart(2, '0')}`
  const input = {
    inputKey: 'offline-benchmark', partnerHistory: [],
    settings: { maxPartnerMeetings: 2, maxOpponentMeetings: 2 },
    pool: reference.ratings.map(([rating, rd], i) => ({ id: id(i), name: `Player ${i}`, rating, rating_deviation: rd, initial_rating: rating, volatility: 0, status: 'active', created_at: '' })),
  }
  const expected = {
    globalBest: reference.globalBest,
    splits: reference.splits.map(s => {
      const squads = s.squads.map(side => side.map(id))
      return { id: squads.map(side => [...side].sort().join(':')).join('|'), squads, bestWorst: s.bestWorst }
    }),
  }
  let nodes = 0
  const started = performance.now()
  const catalog = searchDuelSplits(input, p => { nodes = p.nodes })
  const catalogMs = performance.now() - started
  assert.deepEqual(catalog, expected, 'Optimum or eligible split catalog changed')
  const options = searchDuelOptions(input, catalog.splits[0])
  const totalMs = performance.now() - started
  assert.deepEqual(options.map(({ id, kind }) => ({ id, kind })), reference.options, 'Ranked schedules changed')
  console.log(JSON.stringify({ catalogMs: Math.round(catalogMs), optionsMs: Math.round(totalMs - catalogMs), totalMs: Math.round(totalMs), nodes, globalBest: catalog.globalBest, eligibleSplits: catalog.splits.length, exactReferenceMatch: true }, null, 2))
} finally { await vite.close() }

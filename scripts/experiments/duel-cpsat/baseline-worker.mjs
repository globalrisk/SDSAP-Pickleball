import { parentPort, workerData } from 'node:worker_threads'
import { createServer } from 'vite'
import { performance } from 'node:perf_hooks'

const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false } })
try {
  const { findDuelSchedule } = await vite.ssrLoadModule('/src/lib/flexibleDuel.ts')
  parentPort.postMessage({ type: 'ready' })
  parentPort.once('message', () => {
    const started = performance.now()
    const games = findDuelSchedule(workerData.squads, workerData.settings, workerData.upper)
    parentPort.postMessage({ type: 'result', games, elapsedMs: performance.now() - started })
    void vite.close()
  })
} catch (error) { parentPort.postMessage({ type: 'error', message: error.message }); await vite.close() }

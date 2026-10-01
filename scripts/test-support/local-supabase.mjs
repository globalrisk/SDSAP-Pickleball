import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createTestDatabase } from '../test-database.mjs'

// Minimal PostgREST transport for app integration/browser tests. SQL functions,
// constraints and RLS execute unchanged in disposable PostgreSQL. This service
// only binds loopback and never uses project credentials or the live database.
const identifier = (value) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Invalid SQL identifier')
  return `"${value}"`
}
const splitSelect = (value) => {
  let depth = 0, start = 0
  const result = []
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++
    if (value[i] === ')') depth--
    if (value[i] === ',' && depth === 0) { result.push(value.slice(start, i).trim()); start = i + 1 }
  }
  result.push(value.slice(start).trim())
  return result.filter(Boolean)
}
const relations = {
  seasons: { teams: ['teams', 'id', 'season_id', true], matches: ['matches', 'id', 'season_id', true] },
  teams: { players: ['players', 'id', 'team_id', true], seasons: ['seasons', 'season_id', 'id'] },
  players: { teams: ['teams', 'team_id', 'id'] },
  matches: { seasons: ['seasons', 'season_id', 'id'], home_team: ['teams', 'home_team_id', 'id'], away_team: ['teams', 'away_team_id', 'id'], winner: ['teams', 'winner_team_id', 'id'] },
  league_players: { player_pool: ['player_pool', 'pool_player_id', 'id'], leagues: ['leagues', 'league_id', 'id'] },
  player_pool: { league_players: ['league_players', 'id', 'pool_player_id', true] },
}
function valuesAt(row, path) {
  if (!path.length) return [row]
  if (Array.isArray(row)) return row.flatMap((item) => valuesAt(item, path))
  return valuesAt(row?.[path[0]], path.slice(1))
}
function matchesFilter(row, field, filter) {
  let negate = false
  if (filter.startsWith('not.')) { negate = true; filter = filter.slice(4) }
  const dot = filter.indexOf('.'), op = filter.slice(0, dot), expected = filter.slice(dot + 1)
  const result = valuesAt(row, field.split('.')).some((actual) => {
    if (op === 'is') return expected === 'null' ? actual == null : String(actual) === expected
    if (op === 'in') return expected.slice(1, -1).split(',').map((v) => v.replaceAll('"', '')).includes(String(actual))
    if (op === 'eq') return String(actual) === expected
    if (op === 'neq') return String(actual) !== expected
    throw new Error(`Unsupported test filter ${op}`)
  })
  return negate ? !result : result
}

export async function startLocalSupabase({ port = 0, seed = true } = {}) {
  const db = await createTestDatabase()
  const tables = new Set((await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")).rows.map((r) => r.tablename))
  const claims = { sub: '90000000-0000-4000-8000-000000000001', app_metadata: { role: 'admin' }, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 }
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test-only`
  const user = { id: claims.sub, email: 'admin@example.test', app_metadata: claims.app_metadata, user_metadata: {}, aud: 'authenticated', created_at: new Date().toISOString() }
  let seeded = null
  if (seed) {
    const leagueId = randomUUID(), seasonId = randomUUID()
    const players = Array.from({ length: 14 }, (_, i) => ({ id: randomUUID(), name: `Test player ${String(i + 1).padStart(2, '0')}`, is_new: true, initial_rating: 1500 + (13 - i) * 8 }))
    await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)])
    await db.query('SELECT public.create_league_atomic($1,$2,$3,$4,$5,$6,$7,$8)', [leagueId, 'duel-verification', 'Team Duel Verification', seasonId, 'Season 13 · Local verification', players, [], []])
    await db.query('SELECT public.save_season_roster_atomic($1,$2)', [seasonId, players.map((p) => p.id)])
    seeded = { leagueId, seasonId, players }
  }
  let serial = Promise.resolve()
  const calls = []
  let conflictOnce = false
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    serial = serial.then(async () => {
      const url = new URL(req.url, 'http://localhost')
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
      const admin = req.headers.authorization === `Bearer ${token}`
      if (url.pathname.startsWith('/auth/v1/')) {
        const data = url.pathname.endsWith('/user') ? user : { access_token: token, refresh_token: 'local-test-refresh', token_type: 'bearer', expires_in: 86400, expires_at: claims.exp, user }
        res.end(JSON.stringify(data)); return
      }
      await db.exec('BEGIN')
      try {
        await db.exec(`SET LOCAL ROLE ${admin ? 'authenticated' : 'anon'}`)
        await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(admin ? claims : {})])
        let result
        if (url.pathname.startsWith('/rest/v1/rpc/')) {
          const name = url.pathname.split('/').at(-1)
          calls.push({ name, args: structuredClone(body) })
          if (name === 'save_match_and_ratings_atomic' && conflictOnce) { conflictOnce = false; throw Object.assign(new Error('Rating revision conflict'), { code: '40001' }) }
          const entries = Object.entries(body ?? {})
          result = (await db.query(`SELECT public.${identifier(name)}(${entries.map(([key], i) => `${identifier(key)} => $${i + 1}`).join(',')}) AS value`, entries.map(([, value]) => value))).rows[0]?.value ?? null
        } else {
          const table = url.pathname.split('/').at(-1)
          if (!tables.has(table)) throw new Error('Unknown test table')
          const cache = new Map()
          const getRows = async (target) => {
            if (!cache.has(target)) cache.set(target, (await db.query(`SELECT * FROM public.${identifier(target)}`)).rows)
            return cache.get(target)
          }
          const project = async (target, row, selection) => {
            const projected = {}
            for (const field of splitSelect(selection)) {
              if (field === '*') { Object.assign(projected, row); continue }
              const open = field.indexOf('(')
              if (open === -1) { projected[field] = row[field]; continue }
              const head = field.slice(0, open), alias = head.split(':')[0].split('!')[0]
              const relation = relations[target]?.[alias]
              if (!relation) throw new Error(`Unknown test relationship ${target}.${alias}`)
              const [nextTable, from, to, many] = relation
              const related = (await getRows(nextTable)).filter((r) => r[to] === row[from])
              const nested = await Promise.all(related.map((r) => project(nextTable, r, field.slice(open + 1, -1))))
              projected[alias] = many ? nested : nested[0] ?? null
            }
            return projected
          }
          const selection = url.searchParams.get('select') ?? '*'
          const filters = [...url.searchParams].filter(([key]) => !['select', 'order', 'offset', 'limit'].includes(key))
          const original = await getRows(table)
          const enriched = await Promise.all(original.map(async (row) => ({ row, view: { ...row, ...await project(table, row, selection) } })))
          const selected = enriched.filter(({ view }) => filters.every(([key, filter]) => matchesFilter(view, key, filter))).map(({ row }) => row)
          let rows = selected
          if (req.method === 'POST') {
            rows = []
            for (const item of Array.isArray(body) ? body : [body]) {
              const keys = Object.keys(item)
              rows.push(...(await db.query(`INSERT INTO public.${identifier(table)}(${keys.map(identifier)}) VALUES (${keys.map((_, i) => `$${i + 1}`)}) RETURNING *`, keys.map((key) => item[key]))).rows)
            }
          } else if (req.method === 'PATCH' || req.method === 'DELETE') {
            const ids = selected.map((row) => row.id)
            if (req.method === 'DELETE') rows = (await db.query(`DELETE FROM public.${identifier(table)} WHERE id = ANY($1::uuid[]) RETURNING *`, [ids])).rows
            else {
              const keys = Object.keys(body)
              rows = (await db.query(`UPDATE public.${identifier(table)} SET ${keys.map((key, i) => `${identifier(key)} = $${i + 1}`).join(',')} WHERE id = ANY($${keys.length + 1}::uuid[]) RETURNING *`, [...keys.map((key) => body[key]), ids])).rows
            }
          }
          for (const order of (url.searchParams.get('order') ?? '').split(',').reverse().filter(Boolean)) {
            const [key, direction, nulls] = order.split('.')
            rows.sort((a, b) => a[key] == null || b[key] == null ? a[key] == b[key] ? 0 : a[key] == null ? nulls === 'nullsfirst' ? -1 : 1 : nulls === 'nullsfirst' ? 1 : -1 : (typeof a[key] === 'number' ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]))) * (direction === 'desc' ? -1 : 1))
          }
          const total = rows.length, offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 10000)
          result = await Promise.all(rows.slice(offset, offset + limit).map((row) => project(table, row, selection)))
          res.setHeader('Content-Range', `${offset}-${Math.max(offset, offset + result.length - 1)}/${total}`)
          if (req.headers.accept?.includes('application/vnd.pgrst.object+json')) {
            if (result.length !== 1) throw Object.assign(new Error('Expected one row'), { code: 'PGRST116' })
            result = result[0]
          }
        }
        await db.exec('COMMIT')
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify(result))
      } catch (error) {
        await db.exec('ROLLBACK')
        res.writeHead(error.code === '40001' ? 409 : 400)
        res.end(JSON.stringify({ message: error.message, code: error.code ?? 'TEST_API', details: error.where ?? null, hint: null }))
      }
    }).catch((error) => { res.writeHead(500); res.end(JSON.stringify({ message: error.message })) })
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  return { db, url: `http://127.0.0.1:${server.address().port}`, token, seeded, calls,
    conflictOnNextSave() { conflictOnce = true },
    async close() { await new Promise((resolve) => server.close(resolve)); await db.close() } }
}

if (process.argv[1]?.endsWith('local-supabase.mjs')) {
  const api = await startLocalSupabase({ port: 54329 })
  console.log(`Local-only test Supabase: ${api.url}; league /leagues/duel-verification`)
  process.on('SIGINT', async () => { await api.close(); process.exit() })
}

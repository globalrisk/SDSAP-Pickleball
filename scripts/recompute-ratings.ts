import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { buildRatingsReplacement } from '../src/lib/ratingRepository.ts'

const { values } = parseArgs({
  options: {
    league: { type: 'string' },
    apply: { type: 'boolean', default: false },
    output: { type: 'string' },
  },
})
if (!values.league) throw new Error('Specify --league <slug-or-id>. The default is a dry run.')

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Supabase URL and API key are required.')
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

if (values.apply && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const email = process.env.SUPABASE_ADMIN_EMAIL
  const password = process.env.SUPABASE_ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error('Applying requires admin credentials or a server-only SUPABASE_SERVICE_ROLE_KEY.')
  }
  const { error } = await db.auth.signInWithPassword({ email, password })
  if (error) throw error
}

const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values.league)
const { data: league, error: leagueError } = await db.from('leagues')
  .select('id, slug').eq(isUuid ? 'id' : 'slug', values.league).single()
if (leagueError) throw leagueError

for (let attempt = 0; attempt < 3; attempt += 1) {
  const replacement = await buildRatingsReplacement(db, league.id)
  const args = {
    p_league_id: league.id,
    p_history_rows: replacement.historyRows,
    p_player_ratings: replacement.playerRatings,
    p_expected_revision: replacement.expectedRevision,
  }
  if (values.output) writeFileSync(values.output, JSON.stringify(args, null, 2) + '\n')
  if (values.apply) {
    const { error } = await db.rpc('replace_ratings_atomic', args)
    if (error) {
      if (error.code === '40001' && attempt < 2) continue
      throw error
    }
  }
  const matchCount = new Set(replacement.historyRows.flatMap((row) => row.match_id ? [row.match_id] : [])).size
  console.log(`${values.apply ? 'Recomputed' : 'Dry run:'} ${league.slug}: ${replacement.playerRatings.length} players, ${matchCount} matches, ${replacement.historyRows.length} history rows; revision ${replacement.expectedRevision}`)
  break
}

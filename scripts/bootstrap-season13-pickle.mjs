import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { isPicklePrize, formatPicklePoints } from '../src/lib/picklePoints.ts'

export function parseBootstrapArgs(args) {
  const { values } = parseArgs({ args, options: {
    'match-prize': { type: 'string' }, 'champion-prize': { type: 'string' },
    apply: { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
  } })
  if (!values.help && (!isPicklePrize(values['match-prize'] ?? '') || !isPicklePrize(values['champion-prize'] ?? ''))) {
    throw new Error('Provide --match-prize and --champion-prize as nonnegative multiples of 1000, up to 1000000000000.')
  }
  return values
}

export async function runSeason13Bootstrap(client, options) {
  const { data: seasons, error: lookupError } = await client.from('seasons')
    .select('id, name, status, format, leagues!inner(slug)')
    .eq('leagues.slug', 'sdsap').eq('name', 'Season 13').limit(2)
  if (lookupError) throw lookupError
  if (seasons?.length !== 1 || seasons[0].status !== 'archived' || seasons[0].format !== 'team_duel') {
    throw new Error('Only the unique archived SDSAP Season 13 is eligible.')
  }
  const args = { p_season_id: seasons[0].id, p_match_prize: options['match-prize'], p_champion_prize: options['champion-prize'], p_apply: false }
  const { data: preview, error } = await client.rpc('bootstrap_season13_pickle_points', args)
  if (error) throw error
  if (!options.apply || preview.awarded) return preview
  const applied = await client.rpc('bootstrap_season13_pickle_points', { ...args, p_apply: true, p_expected_preview: preview.fingerprint })
  if (applied.error) throw applied.error
  return applied.data
}

async function main() {
  const options = parseBootstrapArgs(process.argv.slice(2))
  if (options.help) {
    console.log('npm run pickle:season13 -- --match-prize 10000 --champion-prize 100000 [--apply]\nDefaults to a dry run. Requires SUPABASE_ADMIN_EMAIL and SUPABASE_ADMIN_PASSWORD in the environment. Only archived SDSAP Season 13 is eligible.')
    return
  }
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  const email = process.env.SUPABASE_ADMIN_EMAIL
  const password = process.env.SUPABASE_ADMIN_PASSWORD
  if (!url || !key || !email || !password) throw new Error('Supabase URL, anon key and administrator email/password must be configured in the environment.')
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const login = await client.auth.signInWithPassword({ email, password })
  if (login.error) throw login.error
  try {
    const receipt = await runSeason13Bootstrap(client, options)
    console.log(receipt.awarded ? 'Season 13 points awarded (or already awarded with these amounts).' : 'Dry run only: no points awarded.')
    for (const squad of receipt.squads) {
      console.log(`${squad.name}: ${squad.wins} wins; squad total ${formatPicklePoints(squad.total)}; ${squad.memberCount} players; each ${formatPicklePoints(squad.share)}`)
      for (const player of squad.members) console.log(`  ${player.name}: ${formatPicklePoints(squad.share)}`)
    }
  } finally {
    await client.auth.signOut()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}

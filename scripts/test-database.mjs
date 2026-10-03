import { PGlite } from '@electric-sql/pglite'
import { readdir, readFile } from 'node:fs/promises'

// Disposable PostgreSQL, never connected to the production Supabase project.
// Only Supabase-owned auth/storage plumbing is stubbed; application SQL is real.
export async function createTestDatabase({ beforeMigration } = {}) {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, raw_app_meta_data jsonb);
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
      $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT NULLIF(auth.jwt()->>'sub', '')::uuid $$;
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects (id uuid PRIMARY KEY, bucket_id text);
    CREATE PUBLICATION supabase_realtime;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  `)
  for (const file of (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    if (file === beforeMigration) break
    try { await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8')) }
    catch (error) { await db.close(); throw new Error(`Migration ${file}: ${error.message}`, { cause: error }) }
  }
  return db
}

if (process.argv[1]?.endsWith('test-database.mjs')) {
  const db = await createTestDatabase()
  try {
    for (const file of (await readdir('supabase/tests/database')).filter((f) => f.endsWith('.sql')).sort()) {
      try { await db.exec(await readFile(`supabase/tests/database/${file}`, 'utf8')) }
      catch (error) { throw new Error(`Database test ${file}: ${error.message}\n${error.where ?? ''}`) }
      console.log(`PASS ${file}`)
    }
    console.log('All database integration checks passed.')
  } finally { await db.close() }
}

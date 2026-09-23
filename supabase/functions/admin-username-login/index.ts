import { createClient } from 'npm:@supabase/supabase-js@2.110.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}

function defaultKey(dictionaryName: string, legacyName: string): string | undefined {
  const dictionary = Deno.env.get(dictionaryName)
  if (dictionary) {
    try {
      const parsed = JSON.parse(dictionary) as Record<string, string>
      if (parsed.default) return parsed.default
    } catch {
      // Older projects can still supply the legacy key below.
    }
  }
  return Deno.env.get(legacyName)
}

function invalidCredentials(): Response {
  return Response.json(
    { error: 'Invalid username or password.' },
    { status: 401, headers: corsHeaders },
  )
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: corsHeaders })
  }

  let payload: { username?: unknown; password?: unknown }
  try {
    const body = await request.text()
    if (body.length > 4096) return invalidCredentials()
    payload = JSON.parse(body)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalidCredentials()
  } catch {
    return invalidCredentials()
  }

  const username = typeof payload.username === 'string' ? payload.username.trim().toLowerCase() : ''
  const password = payload.password
  if (!/^[a-z][a-z0-9._]{2,31}$/.test(username)
    || typeof password !== 'string' || !password || password.length > 1024) {
    return invalidCredentials()
  }

  const url = Deno.env.get('SUPABASE_URL')
  const secretKey = defaultKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  const publicKey = defaultKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  if (!url || !secretKey || !publicKey) {
    return Response.json({ error: 'Sign-in is unavailable.' }, { status: 503, headers: corsHeaders })
  }

  const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
  const admin = createClient(url, secretKey, options)
  const { data: alias, error: aliasError } = await admin
    .from('admin_usernames')
    .select('user_id')
    .eq('username', username)
    .maybeSingle()
  if (aliasError) {
    return Response.json({ error: 'Sign-in is unavailable.' }, { status: 503, headers: corsHeaders })
  }
  if (!alias) return invalidCredentials()

  const { data: account, error: accountError } = await admin.auth.admin.getUserById(alias.user_id)
  if (accountError || account.user?.app_metadata?.role !== 'admin' || !account.user.email) {
    return invalidCredentials()
  }

  const auth = createClient(url, publicKey, options)
  const { data, error } = await auth.auth.signInWithPassword({
    email: account.user.email,
    password,
  })
  if (error || data.user?.id !== alias.user_id || data.user?.app_metadata?.role !== 'admin'
    || !data.session?.access_token || !data.session.refresh_token) {
    return invalidCredentials()
  }

  return Response.json(
    { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
    { headers: corsHeaders },
  )
})

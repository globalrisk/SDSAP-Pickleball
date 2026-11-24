import { createClient } from 'npm:@supabase/supabase-js@2.110.1'
import { createPasswordResetHandler } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
const secretKey = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const client = url && secretKey ? createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
}) : null

Deno.serve(createPasswordResetHandler(client?.auth ?? null))

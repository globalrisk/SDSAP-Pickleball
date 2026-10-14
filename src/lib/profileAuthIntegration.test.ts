import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { startLocalSupabase } from '../../scripts/test-support/local-supabase.mjs'
const state = vi.hoisted(() => ({ client: null as SupabaseClient | null }))
vi.mock('./supabase', () => ({ supabase: { auth: {
  updateUser: (...args: Parameters<SupabaseClient['auth']['updateUser']>) => state.client!.auth.updateUser(...args),
  getUser: () => state.client!.auth.getUser(),
  signInWithPassword: (...args: Parameters<SupabaseClient['auth']['signInWithPassword']>) => state.client!.auth.signInWithPassword(...args),
} } }))
import { changePlayerPassword } from './playerAuth'
let api: Awaited<ReturnType<typeof startLocalSupabase>>
beforeAll(async () => { api = await startLocalSupabase({ seed: false }); state.client = createClient(api.url, 'local-anon-key', { auth: { persistSession: false, autoRefreshToken: false } }) }, 20000)
afterAll(async () => { await api?.close() })
it('changes a disposable account through the SDK/HTTP transport and permits only the new password afterwards', async () => {
  const account = await api.addAccount({ email: 'profile-password@example.test' })
  expect((await state.client!.auth.signInWithPassword({ email: account.email, password: account.password })).error).toBeNull()
  await expect(changePlayerPassword('incorrect-password', 'new-test-password')).rejects.toMatchObject({ code: 'invalid_credentials' })
  await changePlayerPassword(account.password, 'new-test-password')
  await state.client!.auth.signOut()
  expect((await state.client!.auth.signInWithPassword({ email: account.email, password: account.password })).error).not.toBeNull()
  expect((await state.client!.auth.signInWithPassword({ email: account.email, password: 'new-test-password' })).error).toBeNull()
})

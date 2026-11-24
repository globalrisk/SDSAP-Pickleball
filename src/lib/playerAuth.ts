import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export function validatePasswordChange(currentPassword: string, newPassword: string, confirmation: string) {
  if (!currentPassword) return 'currentRequired'
  if (newPassword.length < 8) return 'tooShort'
  if (newPassword !== confirmation) return 'mismatch'
  return null
}

export async function changePlayerPassword(currentPassword: string, newPassword: string) {
  if (validatePasswordChange(currentPassword, newPassword, newPassword)) throw new Error('PASSWORD_INVALID')
  let { error } = await supabase.auth.updateUser({ current_password: currentPassword, password: newPassword })
  if (error?.code === 'reauthentication_needed') {
    const { data, error: userError } = await supabase.auth.getUser()
    if (userError) throw userError
    if (!data.user?.email) throw new Error('PASSWORD_SESSION')
    const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({ email: data.user.email, password: currentPassword })
    if (signInError) throw signInError
    if (signedIn.user?.id !== data.user.id) throw new Error('PASSWORD_SESSION')
    ;({ error } = await supabase.auth.updateUser({ current_password: currentPassword, password: newPassword }))
  }
  if (error) throw error
}

export async function signUpPlayer(email: string, password: string, emailRedirectTo: string) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo },
  })
  if (error) throw error
  // A user without a session may still need email verification, or may be an
  // intentionally obfuscated response for an existing account.
  return data.session?.user ?? null
}

const resetFailures = ['signIn', 'adminOnly', 'invalid', 'accountChanged', 'protectedAccount',
  'weakPassword', 'samePassword', 'rateLimited', 'unavailable'] as const
type ResetFailure = typeof resetFailures[number]

export async function resetPlayerPassword(userId: string, email: string, password: string): Promise<ResetFailure | null> {
  try {
    const { data, error } = await supabase.functions.invoke<{ ok: boolean }>('admin-player-password-reset', {
      body: { userId, email, password },
    })
    if (!error && data?.ok) return null
    if (error instanceof FunctionsHttpError) {
      const response: Response = error.context
      const body = await response.json().catch(() => null)
      const failure = resetFailures.find(code => code === body?.code)
      if (failure) return failure
      if (response.status === 401) return 'signIn'
      if (response.status === 429) return 'rateLimited'
    }
  } catch {
    // Non-HTTP failures have no safe server error to display.
  }
  return 'unavailable'
}

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

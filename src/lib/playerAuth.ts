import { supabase } from './supabase'

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

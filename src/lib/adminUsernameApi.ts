import { supabase } from './supabase'

export const adminUsernameQueryKey = (userId: string | undefined) =>
  ['admin-username', userId] as const

export async function fetchAdminUsername(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('admin_usernames')
    .select('username')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data?.username ?? null
}

export async function saveAdminUsername(userId: string, username: string): Promise<void> {
  const { error } = await supabase
    .from('admin_usernames')
    .upsert({ user_id: userId, username }, { onConflict: 'user_id' })
  if (error) throw error
}

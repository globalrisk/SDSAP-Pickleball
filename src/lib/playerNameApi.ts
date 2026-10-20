import { supabase } from './supabase'
import type { PlayerAccount } from './betsApi'

export async function renameMyPlayer(playerId: string, name: string): Promise<PlayerAccount> {
  const { data, error } = await supabase.rpc('rename_my_player', {
    p_expected_player_id: playerId,
    p_name: name.trim(),
  })
  if (error) throw error
  return data as PlayerAccount
}

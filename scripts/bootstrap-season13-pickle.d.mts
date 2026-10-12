import type { SupabaseClient } from '@supabase/supabase-js'
import type { PicklePreview } from '../src/lib/picklePoints'
export interface BootstrapOptions { 'match-prize'?: string; 'champion-prize'?: string; apply: boolean; help: boolean }
export function parseBootstrapArgs(args: string[]): BootstrapOptions
export function runSeason13Bootstrap(client: SupabaseClient, options: BootstrapOptions): Promise<PicklePreview>

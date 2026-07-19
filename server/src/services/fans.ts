/**
 * Fan lookup helpers — reads from the `fans` table (social_identity ->
 * wallet_pubkey mapping created by POST /api/auth/register).
 */

import { getSupabaseClient } from '../lib/supabase.js';
import type { FansRow } from '../db/schema.js';

/** Fetches a fan's record by their canonical fan_id, or null if not found. */
export async function getFanById(fanId: string): Promise<FansRow | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('fans')
    .select('*')
    .eq('fan_id', fanId)
    .maybeSingle<FansRow>();

  if (error) {
    console.error('[fans] getFanById error:', error.message);
    return null;
  }

  return data;
}

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

/**
 * Batch fan_id -> tribe_id lookup, for grouping a set of resolved Reads by
 * the tribe(s) whose fans actually made them (see surge tribe-filtering in
 * index.ts). One query regardless of batch size, to stay within the surge
 * broadcast's <500ms budget (Requirement 12.1/12.5).
 */
export async function getTribeIdsByFanIds(fanIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (fanIds.length === 0) return map;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fans')
    .select('fan_id, tribe_id')
    .in('fan_id', fanIds);

  if (error) {
    console.error('[fans] getTribeIdsByFanIds error:', error.message);
    return map;
  }

  for (const row of (data ?? []) as Array<{ fan_id: string; tribe_id: string }>) {
    map.set(row.fan_id, row.tribe_id);
  }

  return map;
}

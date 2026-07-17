/**
 * Read commitment service — business logic for creating Read records,
 * querying pending reads for conviction aggregation, and fan read history.
 *
 * Requirements: 9.1, 9.2
 */

import { getSupabaseClient } from '../lib/supabase.js';
import type { ReadsLiveInsert, ReadsLiveRow } from '../db/schema.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CommitReadData {
  readId: string;
  fanId: string;
  fixtureId: number;
  readType: string;
  predicted: number;
  oddsAtCommit: number;
}

export interface CommitReadResult {
  success: boolean;
  readId: string;
  error?: string;
}

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Commits a Read — creates a reads_live record with status 'pending'.
 * Enforces rate limit: one commit per fan per readId.
 */
export async function commitRead(data: CommitReadData): Promise<CommitReadResult> {
  const supabase = getSupabaseClient();

  // Rate limit: check if fan already committed for this readId
  const { data: existing, error: checkError } = await supabase
    .from('reads_live')
    .select('read_id')
    .eq('fan_id', data.fanId)
    .eq('read_id', data.readId)
    .maybeSingle();

  if (checkError) {
    return { success: false, readId: data.readId, error: checkError.message };
  }

  if (existing) {
    return { success: false, readId: data.readId, error: 'Already committed for this Read' };
  }

  // Insert reads_live record
  const record: ReadsLiveInsert = {
    read_id: data.readId,
    fan_id: data.fanId,
    fixture_id: data.fixtureId,
    read_type: data.readType,
    predicted: data.predicted,
    odds_at_commit: data.oddsAtCommit,
    status: 'pending',
    resolved: null,
    txline_seq: null,
    standing_delta: null,
  };

  const { error: insertError } = await supabase.from('reads_live').insert(record);

  if (insertError) {
    return { success: false, readId: data.readId, error: insertError.message };
  }

  return { success: true, readId: data.readId };
}

/**
 * Retrieves pending reads for a given fixture, optionally filtered by read type.
 * Used by conviction aggregation to compute weighted signal.
 */
export async function getPendingReads(
  fixtureId: number,
  readType?: string
): Promise<ReadsLiveRow[]> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from('reads_live')
    .select('*')
    .eq('fixture_id', fixtureId)
    .eq('status', 'pending');

  if (readType) {
    query = query.eq('read_type', readType);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[Reads] getPendingReads error:', error.message);
    return [];
  }

  return (data as ReadsLiveRow[]) ?? [];
}

/**
 * Retrieves all reads committed by a specific fan.
 */
export async function getReadsByFan(fanId: string): Promise<ReadsLiveRow[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('reads_live')
    .select('*')
    .eq('fan_id', fanId)
    .order('committed_at', { ascending: false });

  if (error) {
    console.error('[Reads] getReadsByFan error:', error.message);
    return [];
  }

  return (data as ReadsLiveRow[]) ?? [];
}

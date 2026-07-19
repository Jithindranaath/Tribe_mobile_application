/**
 * Conviction signal aggregation service.
 *
 * Computes the Standing-weighted conviction signal from all pending reads
 * for a given readId + tribeId, then broadcasts the result via WebSocket.
 *
 * Requirements: 9.3, 9.4, 9.5
 */

import { getSupabaseClient } from '../lib/supabase.js';
import { campfireWS } from '../ws/server.js';
import { getCachedTribeAggregateStanding } from './standing-cache.js';
import type { ReadsLiveRow } from '../db/schema.js';
import type { ConvictionPayload } from '../ws/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConvictionResult {
  readId: string;
  signal: number; // 0.0 to 1.0
  participantCount: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Fallback standing for a fan not found in the cache (shouldn't happen in practice). */
const DEFAULT_FAN_STANDING = 100;

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Fetches all pending reads for a specific readId.
 * This queries reads_live where read_id matches and status is 'pending'.
 */
export async function getPendingReadsByReadId(readId: string): Promise<ReadsLiveRow[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('reads_live')
    .select('*')
    .eq('read_id', readId)
    .eq('status', 'pending');

  if (error) {
    console.error('[Conviction] getPendingReadsByReadId error:', error.message);
    return [];
  }

  return (data as ReadsLiveRow[]) ?? [];
}

/**
 * Fetches cached standing for a set of fans in one query (`fans.cached_standing`
 * — see standing-cache.ts). Missing fans fall back to DEFAULT_FAN_STANDING.
 */
async function getStandingByFanId(fanIds: string[]): Promise<Map<string, number>> {
  const supabase = getSupabaseClient();
  const map = new Map<string, number>();

  if (fanIds.length === 0) return map;

  const { data, error } = await supabase
    .from('fans')
    .select('fan_id, cached_standing')
    .in('fan_id', fanIds);

  if (error) {
    console.error('[Conviction] getStandingByFanId error:', error.message);
    return map;
  }

  for (const row of (data ?? []) as Array<{ fan_id: string; cached_standing: number }>) {
    map.set(row.fan_id, row.cached_standing);
  }

  return map;
}

/**
 * Computes the conviction signal for a given readId within a tribe.
 *
 * Algorithm:
 *   1. Fetch all pending reads for this readId
 *   2. For each read, compute weight = fan's standing / aggregateStanding
 *   3. Signal = sum(weight_i × predicted_i) / sum(weight_i)
 *   4. Normalize to 0.0–1.0 range
 *
 * @param reads - Pending reads_live rows for this readId
 * @param aggregateStanding - The tribe's total aggregate standing (cached)
 * @param standingByFanId - Real per-fan standing (cached); fans not present
 *   fall back to DEFAULT_FAN_STANDING
 * @returns ConvictionResult with signal normalized to [0.0, 1.0]
 */
export function computeConvictionSignalFromReads(
  reads: ReadsLiveRow[],
  aggregateStanding: number,
  standingByFanId?: Map<string, number>,
): ConvictionResult {
  if (reads.length === 0) {
    return {
      readId: '',
      signal: 0,
      participantCount: 0,
    };
  }

  const readId = reads[0].read_id;
  let weightedSum = 0;
  let totalWeight = 0;

  for (const read of reads) {
    const fanStanding = standingByFanId?.get(read.fan_id) ?? DEFAULT_FAN_STANDING;
    const weight = aggregateStanding > 0 ? fanStanding / aggregateStanding : 0;
    weightedSum += weight * read.predicted;
    totalWeight += weight;
  }

  // Normalize: signal = weightedSum / totalWeight, clamped to [0.0, 1.0]
  const rawSignal = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const signal = Math.max(0, Math.min(1, rawSignal));

  return {
    readId,
    signal,
    participantCount: reads.length,
  };
}

/**
 * Full async version: fetches pending reads + real cached standings from DB,
 * computes signal.
 */
export async function computeConvictionSignal(
  readId: string,
  fixtureId: number,
  tribeId: string,
): Promise<ConvictionResult> {
  const reads = await getPendingReadsByReadId(readId);

  if (reads.length === 0) {
    return { readId, signal: 0, participantCount: 0 };
  }

  const [aggregateStanding, standingByFanId] = await Promise.all([
    getCachedTribeAggregateStanding(tribeId),
    getStandingByFanId(reads.map((r) => r.fan_id)),
  ]);

  const result = computeConvictionSignalFromReads(reads, aggregateStanding, standingByFanId);
  // Ensure readId is set correctly even when reads array is from a different source
  return { ...result, readId };
}

/**
 * Computes conviction signal and broadcasts it to all tribe members
 * via WebSocket. Called after each new Read commitment.
 *
 * Uses cached standing (see standing-cache.ts) — no on-chain RPC call on this
 * path, which matters since this runs on every commit and has a <1s budget.
 *
 * @param readId - The unique ID of the Read prompt
 * @param fixtureId - The fixture this read belongs to
 * @param tribeId - The tribe whose conviction we're computing
 */
export async function broadcastConviction(
  readId: string,
  fixtureId: number,
  tribeId: string,
): Promise<ConvictionResult> {
  const result = await computeConvictionSignal(readId, fixtureId, tribeId);

  const payload: ConvictionPayload = {
    readId: result.readId,
    signal: result.signal,
    participantCount: result.participantCount,
  };

  campfireWS.broadcastConviction(tribeId, String(fixtureId), payload);

  // Persist so it can be read back later (e.g. moment classification needs the
  // conviction signal at resolution time — nothing else stores this).
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('tribes_live').upsert(
    { tribe_id: tribeId, conviction_signal: { readId: result.readId, signal: result.signal }, last_updated: new Date().toISOString() },
    { onConflict: 'tribe_id' },
  );
  if (error) {
    console.error('[Conviction] Failed to persist conviction_signal:', error.message);
  }

  return result;
}

/**
 * Reads back the conviction signal last persisted for a tribe (see
 * `broadcastConviction` above — the only writer of `tribes_live.conviction_signal`).
 * Defaults to neutral (0.5) if nothing has been persisted yet.
 */
export async function getPersistedConvictionSignal(tribeId: string): Promise<number> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('tribes_live')
    .select('conviction_signal')
    .eq('tribe_id', tribeId)
    .maybeSingle();

  const signal = (data?.conviction_signal as { signal?: number } | null)?.signal;
  return typeof signal === 'number' ? signal : 0.5;
}

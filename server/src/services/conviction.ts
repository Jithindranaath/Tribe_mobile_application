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
import type { ReadsLiveRow } from '../db/schema.js';
import type { ConvictionPayload } from '../ws/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConvictionResult {
  readId: string;
  signal: number; // 0.0 to 1.0
  participantCount: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Default standing per fan. Used as a placeholder until on-chain Standing
 * queries are available.
 */
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
 * Computes the conviction signal for a given readId within a tribe.
 *
 * Algorithm:
 *   1. Fetch all pending reads for this readId
 *   2. For each read, compute weight = fan's standing / aggregateStanding
 *   3. Signal = sum(weight_i × predicted_i) / sum(weight_i)
 *   4. Normalize to 0.0–1.0 range
 *
 * Since on-chain Standing queries are not yet available, each fan uses
 * DEFAULT_FAN_STANDING (100). When all fans have equal standing, the signal
 * simplifies to an unweighted average — but the weighted structure is in place
 * for when real standings are fetched.
 *
 * @param readId - The unique ID of the Read prompt
 * @param fixtureId - The fixture this read belongs to (for context/filtering)
 * @param tribeId - The tribe whose conviction we're computing
 * @param aggregateStanding - The tribe's total aggregate standing
 * @returns ConvictionResult with signal normalized to [0.0, 1.0]
 */
export function computeConvictionSignalFromReads(
  reads: ReadsLiveRow[],
  aggregateStanding: number
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
    const fanStanding = DEFAULT_FAN_STANDING;
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
 * Full async version: fetches pending reads from DB, computes signal.
 */
export async function computeConvictionSignal(
  readId: string,
  fixtureId: number,
  tribeId: string,
  aggregateStanding: number
): Promise<ConvictionResult> {
  const reads = await getPendingReadsByReadId(readId);

  if (reads.length === 0) {
    return { readId, signal: 0, participantCount: 0 };
  }

  const result = computeConvictionSignalFromReads(reads, aggregateStanding);
  // Ensure readId is set correctly even when reads array is from a different source
  return { ...result, readId };
}

/**
 * Computes conviction signal and broadcasts it to all tribe members
 * via WebSocket. Called after each new Read commitment.
 *
 * @param readId - The unique ID of the Read prompt
 * @param fixtureId - The fixture this read belongs to
 * @param tribeId - The tribe whose conviction we're computing
 * @param aggregateStanding - The tribe's total aggregate standing
 */
export async function broadcastConviction(
  readId: string,
  fixtureId: number,
  tribeId: string,
  aggregateStanding: number
): Promise<ConvictionResult> {
  const result = await computeConvictionSignal(readId, fixtureId, tribeId, aggregateStanding);

  const payload: ConvictionPayload = {
    readId: result.readId,
    signal: result.signal,
    participantCount: result.participantCount,
  };

  campfireWS.broadcastConviction(tribeId, String(fixtureId), payload);

  return result;
}

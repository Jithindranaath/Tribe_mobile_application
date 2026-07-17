/**
 * Notable Moment Classifier and Timeline Entry Service.
 *
 * After Read resolution, classifies whether a resolved Read qualifies as a
 * "notable moment" for the fan's Legacy timeline.
 *
 * Notability conditions (any one is sufficient):
 *   A: difficulty_multiplier > 2.0 (long odds, rare outcome)
 *   B: timingBonusPercentile >= 0.9 (top 10% timing for that read_type)
 *   C: |predicted - convictionSignal| > 0.7 (against-the-grain call)
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4
 */

import { getSupabaseClient } from '../lib/supabase.js';
import type { ReadsLiveRow, TimelineInsert } from '../db/schema.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MomentClassification {
  isNotable: boolean;
  reasons: string[];
}

export interface ReadForClassification {
  odds_at_commit: number | null;
  predicted: number;
}

// ─── Pure Functions ──────────────────────────────────────────────────────────

/**
 * Classifies whether a resolved Read qualifies as a notable moment.
 *
 * Pure function — no side effects, no DB access.
 *
 * @param read - The resolved read (needs odds_at_commit and predicted)
 * @param convictionSignal - The tribe's conviction signal at resolution time (0.0–1.0)
 * @param timingBonusPercentile - Percentile rank of this read's timing_bonus
 *                                within its read_type (0.0–1.0)
 * @returns Classification with isNotable flag and list of qualifying reasons
 */
export function classifyMoment(
  read: ReadForClassification,
  convictionSignal: number,
  timingBonusPercentile: number
): MomentClassification {
  const reasons: string[] = [];

  // Condition A: difficulty_multiplier > 2.0
  const difficultyMultiplier = read.odds_at_commit ?? 1.0;
  if (difficultyMultiplier > 2.0) {
    reasons.push('high_difficulty');
  }

  // Condition B: timing_bonus in top 10% for that read_type
  if (timingBonusPercentile >= 0.9) {
    reasons.push('top_timing');
  }

  // Condition C: |predicted - conviction_signal| > 0.7 (against-the-grain call)
  if (Math.abs(read.predicted - convictionSignal) > 0.7) {
    reasons.push('against_the_grain');
  }

  return {
    isNotable: reasons.length > 0,
    reasons,
  };
}

// ─── Database Functions ──────────────────────────────────────────────────────

/**
 * Creates a timeline entry for a notable moment.
 *
 * Inserts into the `timeline` table with type 'READ_SUCCESS' and the
 * relevant read details as payload.
 *
 * @param read - The full resolved read row
 * @param fixtureId - The fixture this moment belongs to
 * @param reasons - The notability reasons from classifyMoment
 * @returns The created timeline entry ID, or null on failure
 */
export async function createTimelineEntry(
  read: ReadsLiveRow,
  fixtureId: number,
  reasons: string[]
): Promise<string | null> {
  const supabase = getSupabaseClient();

  const momentId = `moment-${read.read_id}`;

  const entry: TimelineInsert = {
    fan_id: read.fan_id,
    moment_id: momentId,
    fixture_id: fixtureId,
    type: 'READ_SUCCESS',
    payload_json: {
      readId: read.read_id,
      readType: read.read_type,
      predicted: read.predicted,
      resolved: read.resolved,
      correct: read.predicted === read.resolved,
      difficulty: read.odds_at_commit,
      standingDelta: read.standing_delta,
      reasons,
    },
  };

  const { data, error } = await supabase
    .from('timeline')
    .insert(entry)
    .select('id')
    .single();

  if (error) {
    console.error('[Moments] Failed to create timeline entry:', error.message);
    return null;
  }

  console.log(`[Moments] Notable moment captured for fan ${read.fan_id}: ${reasons.join(', ')}`);
  return data?.id ?? null;
}

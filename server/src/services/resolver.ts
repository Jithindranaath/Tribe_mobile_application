/**
 * Read Resolver Service — resolves pending Reads when TxLINE match events arrive.
 *
 * Subscribes to GOAL_EVENT on the internal event bus, queries pending reads
 * matching the fixture, determines correctness, computes Standing delta,
 * and updates reads_live with resolution data.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */

import {
  EventBus,
  GOAL_EVENT,
  GoalEvent,
} from '../events/event-bus.js';
import { getSupabaseClient } from '../lib/supabase.js';
import type { ReadsLiveRow } from '../db/schema.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Resolution {
  fanId: string;
  readId: string;
  correct: boolean;
  standingDelta: number;
  txLineSeq: number;
}

// ─── Pure Computation ────────────────────────────────────────────────────────

/**
 * Computes the Standing delta for a resolved Read.
 *
 * - Correct: base_points(100) × difficulty_multiplier × timing_bonus
 *   - timing_bonus = min(2.0, 1.0 + seconds_early / 300)
 * - Incorrect: -5
 *
 * @param correct Whether the fan's prediction was correct
 * @param difficultyMultiplier The odds-derived difficulty (1.0–5.0)
 * @param secondsEarly Seconds between commit time and resolution event
 * @returns Signed Standing delta
 */
export function computeStandingDelta(
  correct: boolean,
  difficultyMultiplier: number,
  secondsEarly: number
): number {
  if (!correct) {
    return -5;
  }

  const BASE_POINTS = 100;
  const timingBonus = Math.min(2.0, 1.0 + secondsEarly / 300);
  return Math.round(BASE_POINTS * difficultyMultiplier * timingBonus);
}

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Callback invoked after reads are resolved for a GOAL_EVENT.
 * Used by the SurgeService to trigger immediate WebSocket broadcasts.
 */
export type OnResolutionCallback = (fixtureId: string, resolutions: Resolution[]) => void;

// ─── ReadResolver Class ──────────────────────────────────────────────────────

export class ReadResolver {
  private eventBus: EventBus;
  private goalHandler: ((event: GoalEvent) => void) | null = null;
  private onResolutionCallbacks: OnResolutionCallback[] = [];

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Register a callback that fires after reads are resolved for a GOAL_EVENT.
   * Used to wire in the SurgeService for immediate WebSocket broadcasts.
   */
  onResolution(callback: OnResolutionCallback): void {
    this.onResolutionCallbacks.push(callback);
  }

  /**
   * Start subscribing to GOAL_EVENT on the event bus.
   */
  start(): void {
    this.goalHandler = (event: GoalEvent) => {
      this.handleGoalEvent(event).catch((err) => {
        console.error('[ReadResolver] Error handling goal event:', err);
      });
    };
    this.eventBus.on(GOAL_EVENT, this.goalHandler);
    console.log('[ReadResolver] Started — listening for GOAL_EVENT');
  }

  /**
   * Stop subscribing to events.
   */
  stop(): void {
    if (this.goalHandler) {
      this.eventBus.off(GOAL_EVENT, this.goalHandler);
      this.goalHandler = null;
    }
    console.log('[ReadResolver] Stopped');
  }

  /**
   * Handle a GOAL_EVENT: resolve all pending moment_read Reads for the fixture,
   * then notify all registered onResolution callbacks (e.g. SurgeService).
   */
  private async handleGoalEvent(event: GoalEvent): Promise<Resolution[]> {
    const resolutions = await this.resolveReadsForEvent(event);

    // Fire resolution callbacks (surge broadcast, settlement queue, etc.)
    for (const callback of this.onResolutionCallbacks) {
      try {
        callback(event.fixtureId, resolutions);
      } catch (err) {
        console.error('[ReadResolver] onResolution callback error:', err);
      }
    }

    return resolutions;
  }

  /**
   * Core resolution logic:
   * 1. Query pending reads matching fixture_id + read_type + status='pending'
   * 2. For each, determine correctness (predicted === 1 means "yes goal")
   * 3. Compute Standing delta
   * 4. Update reads_live with resolved state
   */
  async resolveReadsForEvent(event: GoalEvent): Promise<Resolution[]> {
    const supabase = getSupabaseClient();

    // Query pending reads for this fixture + moment_read
    const { data: pendingReads, error } = await supabase
      .from('reads_live')
      .select('*')
      .eq('fixture_id', event.fixtureId)
      .eq('read_type', 'moment_read')
      .eq('status', 'pending');

    if (error) {
      console.error('[ReadResolver] Query error:', error.message);
      return [];
    }

    if (!pendingReads || pendingReads.length === 0) {
      return [];
    }

    const resolutions: Resolution[] = [];

    for (const read of pendingReads as ReadsLiveRow[]) {
      // A goal happened → actual outcome is 1 ("yes goal")
      const actualOutcome = 1;
      const correct = read.predicted === actualOutcome;

      // Compute seconds_early: time between commit and resolving event
      const committedAtMs = new Date(read.committed_at).getTime();
      const secondsEarly = Math.max(0, (event.timestamp - committedAtMs) / 1000);

      // difficulty_multiplier stored as odds_at_commit
      const difficultyMultiplier = read.odds_at_commit ?? 1.0;

      const standingDelta = computeStandingDelta(correct, difficultyMultiplier, secondsEarly);

      // Update the read record in DB
      const { error: updateError } = await supabase
        .from('reads_live')
        .update({
          resolved: actualOutcome,
          txline_seq: event.seq,
          status: 'resolved',
          standing_delta: standingDelta,
        })
        .eq('read_id', read.read_id);

      if (updateError) {
        console.error(`[ReadResolver] Update error for read ${read.read_id}:`, updateError.message);
        continue;
      }

      resolutions.push({
        fanId: read.fan_id,
        readId: read.read_id,
        correct,
        standingDelta,
        txLineSeq: event.seq,
      });
    }

    console.log(
      `[ReadResolver] Resolved ${resolutions.length} reads for fixture ${event.fixtureId}`
    );

    return resolutions;
  }
}

/**
 * Settlement Executor — settles resolved Read batches on-chain.
 *
 * Each resolution in a batch is settled with a real `settle_read` call
 * (via services/onchain.ts). Retry logic and error handling:
 * - On tx failure: retry the whole batch up to 3 times with increasing
 *   priority fee multipliers [1.2×, 1.5×, 2.0×]
 * - On final failure: log error + alert operators; never surface error to fan
 *
 * Requirements: 27.4, 27.5
 */

import type { Resolution } from './resolver.js';
import { getFanById } from './fans.js';
import { deriveMacroId, deriveRegionId, deriveTribePda, settleReadOnChain } from './onchain.js';
import { bumpCachedFanStanding, bumpCachedTribeAggregateStanding } from './standing-cache.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SettlementResult {
  success: boolean;
  txSignature?: string;
  attempt: number;
  priorityFeeMultiplier: number;
  error?: string;
}

export type OnSettledCallback = (batch: Resolution[], txSignature: string) => void;
export type OnFailedCallback = (batch: Resolution[], error: string) => void;

/**
 * Settles an entire batch on-chain, returning the last transaction signature.
 * Throws on any failure (any resolution in the batch failing to settle fails
 * the whole attempt, which SettlementExecutor will retry).
 */
export type AttemptSettlementFn = (
  batch: Resolution[],
  priorityFeeMicroLamports: number,
) => Promise<string>;

export interface SettlementExecutorOptions {
  /** Injectable settlement function. Defaults to real on-chain settle_read calls. */
  attemptSettlement?: AttemptSettlementFn;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Priority fee multipliers for each retry attempt */
export const PRIORITY_FEE_MULTIPLIERS = [1.2, 1.5, 2.0] as const;

/** Maximum number of retry attempts */
export const MAX_RETRIES = 3;

/** Base priority fee in micro-lamports */
export const BASE_PRIORITY_FEE = 10_000;

// ─── Default (real) settlement implementation ─────────────────────────────────

/**
 * Settles every resolution in the batch on-chain, sequentially. Looks up each
 * fan's wallet + tribe from the `fans` table (populated by
 * POST /api/auth/register) to derive the on-chain accounts.
 */
async function defaultAttemptSettlement(
  batch: Resolution[],
  priorityFeeMicroLamports: number,
): Promise<string> {
  let lastSignature = '';

  for (const resolution of batch) {
    const fan = await getFanById(resolution.fanId);
    if (!fan) {
      throw new Error(`[SettlementExecutor] No fan record found for fan_id ${resolution.fanId}`);
    }

    const macroId = deriveMacroId(fan.macro_tribe);
    const regionId = deriveRegionId(fan.tribe_id);
    const tribePda = deriveTribePda(macroId, regionId);

    const { txSignature } = await settleReadOnChain({
      walletAddress: fan.wallet_pubkey,
      tribePda,
      fixtureId: resolution.fixtureId,
      readId: resolution.readId,
      readType: resolution.readType,
      predicted: resolution.predicted,
      resolved: resolution.resolved,
      txLineSeq: resolution.txLineSeq,
      correct: resolution.correct,
      standingDelta: resolution.standingDelta,
      priorityFeeMicroLamports,
    });

    lastSignature = txSignature;

    // Mirror the on-chain change into the cache in the same step — see
    // standing-cache.ts for why this is event-driven rather than polled.
    await bumpCachedFanStanding(resolution.fanId, resolution.standingDelta);
    await bumpCachedTribeAggregateStanding(fan.tribe_id, resolution.standingDelta);
  }

  return lastSignature;
}

// ─── SettlementExecutor Class ────────────────────────────────────────────────

export class SettlementExecutor {
  private onSettled: OnSettledCallback | null = null;
  private onFailed: OnFailedCallback | null = null;
  private failedBatches: Array<{ batch: Resolution[]; error: string; timestamp: number }> = [];
  private attemptSettlement: AttemptSettlementFn;

  constructor(options?: SettlementExecutorOptions) {
    this.attemptSettlement = options?.attemptSettlement ?? defaultAttemptSettlement;
  }

  /** Set callback for successful settlements. */
  setOnSettled(callback: OnSettledCallback): void {
    this.onSettled = callback;
  }

  /** Set callback for exhausted retries (all attempts failed). */
  setOnFailed(callback: OnFailedCallback): void {
    this.onFailed = callback;
  }

  /** Get all failed batches that have been recorded in memory. */
  getFailedBatches(): ReadonlyArray<{ batch: Resolution[]; error: string; timestamp: number }> {
    return this.failedBatches;
  }

  /**
   * Execute settlement for a batch of resolutions.
   *
   * Attempts the real on-chain transaction(s). On failure, retries up to 3
   * times with increasing priority fees. On final failure, logs the error and
   * alerts operators but never throws (settlement failures are silent to fans).
   */
  async executeBatch(batch: Resolution[]): Promise<SettlementResult> {
    if (batch.length === 0) {
      return { success: true, attempt: 0, priorityFeeMultiplier: 1.0 };
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const priorityFeeMultiplier = attempt === 0 ? 1.0 : PRIORITY_FEE_MULTIPLIERS[attempt - 1];
      const priorityFeeMicroLamports = Math.round(BASE_PRIORITY_FEE * priorityFeeMultiplier);

      try {
        const txSignature = await this.attemptSettlement(batch, priorityFeeMicroLamports);
        const result: SettlementResult = {
          success: true,
          txSignature,
          attempt: attempt + 1,
          priorityFeeMultiplier,
        };
        this.handleSuccess(batch, result);
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_RETRIES) {
          console.warn(
            `[SettlementExecutor] Retry ${attempt + 1}/${MAX_RETRIES} failed ` +
              `(priority fee ${priorityFeeMultiplier}×): ${errorMessage}`,
          );
        }
      }
    }

    // All retries exhausted — operator alert, never surface to fans
    const finalError =
      `Settlement failed after ${MAX_RETRIES} retries for batch of ${batch.length} resolutions`;
    this.handleFinalFailure(batch, finalError);

    return {
      success: false,
      attempt: MAX_RETRIES + 1, // initial attempt + retries
      priorityFeeMultiplier: PRIORITY_FEE_MULTIPLIERS[MAX_RETRIES - 1],
      error: finalError,
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private handleSuccess(batch: Resolution[], result: SettlementResult): void {
    console.log(
      `[SettlementExecutor] ✔ Settled ${batch.length} resolutions ` +
        `(attempt ${result.attempt}, priority ${result.priorityFeeMultiplier}×) ` +
        `tx: ${result.txSignature}`
    );

    if (this.onSettled && result.txSignature) {
      this.onSettled(batch, result.txSignature);
    }
  }

  private handleFinalFailure(batch: Resolution[], error: string): void {
    // Log error for operators (requirement 27.5: alert operators)
    console.error(`[SettlementExecutor] ✘ OPERATOR ALERT: ${error}`);
    console.error(
      `[SettlementExecutor] Failed batch fan IDs: ${batch.map((r) => r.fanId).join(', ')}`
    );

    // Track in memory
    this.failedBatches.push({
      batch,
      error,
      timestamp: Date.now(),
    });

    // Fire callback
    if (this.onFailed) {
      this.onFailed(batch, error);
    }

    // Never throw — settlement failures are silent to fans (requirement 27.5)
  }
}

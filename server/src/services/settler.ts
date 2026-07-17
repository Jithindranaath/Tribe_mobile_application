/**
 * Settlement Executor — attempts to settle resolved Read batches on-chain.
 *
 * For the hackathon, the actual Solana transaction is simulated (since we can't
 * run Anchor without the CLI in this context). The retry logic and error handling
 * are real and production-ready.
 *
 * Retry policy:
 * - On tx failure: retry up to 3 times with increasing priority fee multipliers
 *   [1.2×, 1.5×, 2.0×]
 * - On final failure: log error + alert operators; never surface error to fan
 *
 * Requirements: 27.4, 27.5
 */

import type { Resolution } from './resolver.js';

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
 * Options for simulating on-chain transaction behavior during development.
 * In production, these would be replaced by real Solana transaction mechanics.
 */
export interface SimulationOptions {
  /** Simulated delay per transaction attempt in ms (default: 200) */
  delayMs?: number;
  /** Probability of success per attempt, 0.0–1.0 (default: 0.9) */
  successRate?: number;
  /**
   * Optional deterministic sequence of outcomes for testing.
   * Each entry is true (success) or false (failure).
   * When provided, successRate is ignored and outcomes are consumed in order.
   */
  outcomeSequence?: boolean[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Priority fee multipliers for each retry attempt */
export const PRIORITY_FEE_MULTIPLIERS = [1.2, 1.5, 2.0] as const;

/** Maximum number of retry attempts */
export const MAX_RETRIES = 3;

/** Base priority fee in micro-lamports (for real implementation) */
export const BASE_PRIORITY_FEE = 10_000;

// ─── SettlementExecutor Class ────────────────────────────────────────────────

export class SettlementExecutor {
  private onSettled: OnSettledCallback | null = null;
  private onFailed: OnFailedCallback | null = null;
  private failedBatches: Array<{ batch: Resolution[]; error: string; timestamp: number }> = [];
  private simulationOptions: SimulationOptions;
  private outcomeIndex = 0;

  constructor(options?: SimulationOptions) {
    this.simulationOptions = {
      delayMs: options?.delayMs ?? 200,
      successRate: options?.successRate ?? 0.9,
      outcomeSequence: options?.outcomeSequence,
    };
  }

  /**
   * Set callback for successful settlements.
   */
  setOnSettled(callback: OnSettledCallback): void {
    this.onSettled = callback;
  }

  /**
   * Set callback for exhausted retries (all attempts failed).
   */
  setOnFailed(callback: OnFailedCallback): void {
    this.onFailed = callback;
  }

  /**
   * Get all failed batches that have been recorded in memory.
   */
  getFailedBatches(): ReadonlyArray<{ batch: Resolution[]; error: string; timestamp: number }> {
    return this.failedBatches;
  }

  /**
   * Execute settlement for a batch of resolutions.
   *
   * Attempts to submit the on-chain transaction. On failure, retries up to 3
   * times with increasing priority fees. On final failure, logs the error and
   * alerts operators but never throws (settlement failures are silent to fans).
   *
   * @param batch - Array of Resolution objects to settle on-chain
   */
  async executeBatch(batch: Resolution[]): Promise<SettlementResult> {
    if (batch.length === 0) {
      return { success: true, attempt: 0, priorityFeeMultiplier: 1.0 };
    }

    // First attempt with base priority fee
    const firstResult = await this.attemptTransaction(batch, 1.0);
    if (firstResult.success) {
      this.handleSuccess(batch, firstResult);
      return firstResult;
    }

    // Retry with increasing priority fee multipliers
    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      const multiplier = PRIORITY_FEE_MULTIPLIERS[retry];
      const result = await this.attemptTransaction(batch, multiplier);

      if (result.success) {
        this.handleSuccess(batch, result);
        return result;
      }

      // Log retry attempt
      console.warn(
        `[SettlementExecutor] Retry ${retry + 1}/${MAX_RETRIES} failed ` +
          `(priority fee ${multiplier}×): ${result.error}`
      );
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

  /**
   * Attempt a single on-chain transaction.
   *
   * For hackathon: simulates the transaction with configurable delay and
   * success rate.
   *
   * Real implementation would:
   * 1. Construct `settle_reads` instruction per resolution
   * 2. Build transaction with ComputeBudget priority fee
   * 3. Send and confirm transaction
   */
  private async attemptTransaction(
    batch: Resolution[],
    priorityFeeMultiplier: number
  ): Promise<SettlementResult> {
    const attempt = priorityFeeMultiplier === 1.0
      ? 1
      : PRIORITY_FEE_MULTIPLIERS.indexOf(priorityFeeMultiplier as typeof PRIORITY_FEE_MULTIPLIERS[number]) + 2;

    try {
      // Simulate network delay
      await this.simulateDelay();

      // Simulate transaction success/failure
      const success = this.simulateOutcome();

      if (success) {
        // Generate a fake tx signature for simulation
        const txSignature = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        return {
          success: true,
          txSignature,
          attempt,
          priorityFeeMultiplier,
        };
      } else {
        return {
          success: false,
          attempt,
          priorityFeeMultiplier,
          error: 'Simulated transaction failure (blockhash expired or insufficient funds)',
        };
      }
    } catch (err) {
      return {
        success: false,
        attempt,
        priorityFeeMultiplier,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

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

  private simulateDelay(): Promise<void> {
    const delayMs = this.simulationOptions.delayMs ?? 200;
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private simulateOutcome(): boolean {
    const { outcomeSequence, successRate } = this.simulationOptions;
    if (outcomeSequence && this.outcomeIndex < outcomeSequence.length) {
      return outcomeSequence[this.outcomeIndex++];
    }
    return Math.random() < (successRate ?? 0.9);
  }
}

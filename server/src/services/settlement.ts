/**
 * Settlement Queue Service — batches resolved Reads for on-chain settlement.
 *
 * Collects Resolution objects and triggers a batch when either:
 * - 60 seconds have elapsed since the first queued resolution, OR
 * - 20 resolutions are queued (whichever comes first)
 *
 * Requirements: 10.6, 11.1
 */

import type { Resolution } from './resolver.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type BatchReadyCallback = (batch: Resolution[]) => void;

// ─── SettlementQueue Class ───────────────────────────────────────────────────

export class SettlementQueue {
  private resolutions: Resolution[] = [];
  private firstQueuedAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onBatchReady: BatchReadyCallback | null = null;

  /** Maximum number of resolutions before triggering immediately */
  static readonly MAX_BATCH_SIZE = 20;

  /** Maximum time (ms) to wait after first queued resolution */
  static readonly BATCH_TIMEOUT_MS = 60_000;

  constructor(onBatchReady?: BatchReadyCallback) {
    this.onBatchReady = onBatchReady ?? null;
  }

  /**
   * Set or replace the batch-ready callback.
   */
  setOnBatchReady(callback: BatchReadyCallback): void {
    this.onBatchReady = callback;
  }

  /**
   * Add one or more resolutions to the queue.
   * Starts the 60s timer on first item; triggers immediately at 20 items.
   */
  queue(resolution: Resolution): void;
  queue(resolutions: Resolution[]): void;
  queue(input: Resolution | Resolution[]): void {
    const items = Array.isArray(input) ? input : [input];

    if (items.length === 0) {
      return;
    }

    for (const item of items) {
      this.resolutions.push(item);
    }

    // Start timer on first queued item
    if (this.firstQueuedAt === null) {
      this.firstQueuedAt = Date.now();
      this.startTimer();
    }

    // Check count threshold
    if (this.resolutions.length >= SettlementQueue.MAX_BATCH_SIZE) {
      this.triggerBatch();
    }
  }

  /**
   * Force-trigger the current batch (useful for testing/shutdown).
   * No-op if queue is empty.
   */
  flush(): void {
    if (this.resolutions.length > 0) {
      this.triggerBatch();
    }
  }

  /**
   * Get the current number of queued resolutions.
   */
  getQueueSize(): number {
    return this.resolutions.length;
  }

  /**
   * Clear the queue and cancel any pending timer without triggering a batch.
   */
  reset(): void {
    this.resolutions = [];
    this.firstQueuedAt = null;
    this.cancelTimer();
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private startTimer(): void {
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.triggerBatch();
    }, SettlementQueue.BATCH_TIMEOUT_MS);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private triggerBatch(): void {
    this.cancelTimer();

    const batch = this.resolutions;
    this.resolutions = [];
    this.firstQueuedAt = null;

    if (this.onBatchReady && batch.length > 0) {
      this.onBatchReady(batch);
    }
  }
}

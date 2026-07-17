/**
 * Proactive JWT Refresh Loop for TxLINE.
 *
 * Schedules refresh at 83% of JWT lifetime so we never hit expiration
 * mid-stream. On refresh, calls acquireGuestJWT() and notifies the caller
 * (e.g., to reconnect SSE streams with the new JWT, same API token).
 *
 * Failure handling: exponential backoff [1s, 2s, 4s, 8s, 16s], max 5 attempts.
 * After 5 consecutive failures, emits 'refresh_failed' so the caller can
 * enter Replay Mode or take other recovery action.
 */

import { EventEmitter } from 'node:events';
import { TxLINEAuth } from './auth.js';

/** Fraction of JWT lifetime at which to proactively refresh (83% ≈ 50 min of 60 min). */
const REFRESH_FRACTION = 0.83;

/** Base backoff delays in milliseconds for retry attempts. */
const BACKOFF_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

/** Maximum number of consecutive refresh failures before giving up. */
const MAX_RETRY_ATTEMPTS = 5;

export type RefreshCallback = (newJwt: string) => void | Promise<void>;

export interface JWTRefreshLoopOptions {
  /** Called after a successful refresh with the new JWT. */
  onRefresh?: RefreshCallback;
}

export class JWTRefreshLoop extends EventEmitter {
  private auth: TxLINEAuth;
  private onRefresh?: RefreshCallback;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private consecutiveFailures = 0;

  constructor(auth: TxLINEAuth, options?: JWTRefreshLoopOptions) {
    super();
    this.auth = auth;
    this.onRefresh = options?.onRefresh;
  }

  /**
   * Starts the proactive refresh loop.
   * Schedules the first refresh at 83% of the current JWT's remaining lifetime.
   * If no JWT is currently stored, refreshes immediately.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.consecutiveFailures = 0;
    this.scheduleNextRefresh();
  }

  /**
   * Stops the refresh loop and cancels any pending timers.
   */
  stop(): void {
    this.running = false;
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Whether the loop is currently active. */
  get isRunning(): boolean {
    return this.running;
  }

  // ──────────────────────────────────────────────
  // Internal scheduling
  // ──────────────────────────────────────────────

  private scheduleNextRefresh(): void {
    if (!this.running) return;

    const delayMs = this.computeRefreshDelay();

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.performRefresh();
    }, delayMs);
  }

  /**
   * Computes how long to wait before the next refresh.
   * Uses 83% of the remaining JWT lifetime. If the JWT is already expired
   * or not acquired, returns 0 (refresh immediately).
   */
  private computeRefreshDelay(): number {
    const expiresAt = this.auth.getExpiresAt();
    if (expiresAt === null) {
      // No JWT yet — refresh immediately
      return 0;
    }

    const now = Date.now();
    const remainingMs = expiresAt - now;

    if (remainingMs <= 0) {
      // Already expired — refresh immediately
      return 0;
    }

    // Schedule at 83% of the total lifetime (not remaining time).
    // Total lifetime = expiresAt - (expiresAt - expiresIn*1000) but we don't
    // have access to the original expiresIn here. Instead, use remaining time
    // and schedule at REFRESH_FRACTION of remaining from the current moment:
    // This effectively fires when ~83% of the remaining lifetime has elapsed.
    return Math.floor(remainingMs * REFRESH_FRACTION);
  }

  private async performRefresh(): Promise<void> {
    if (!this.running) return;

    try {
      const { jwt } = await this.auth.acquireGuestJWT();
      this.consecutiveFailures = 0;

      // Notify caller (e.g., reconnect SSE streams with new JWT)
      if (this.onRefresh) {
        await this.onRefresh(jwt);
      }

      // Schedule the next refresh based on new JWT lifetime
      this.scheduleNextRefresh();
    } catch (error) {
      this.consecutiveFailures++;

      if (this.consecutiveFailures >= MAX_RETRY_ATTEMPTS) {
        // All retries exhausted — emit failure event
        this.emit('refresh_failed', {
          attempts: this.consecutiveFailures,
          lastError: error instanceof Error ? error.message : String(error),
        });
        // Stop the loop; caller should handle (e.g., enter Replay Mode)
        this.running = false;
        return;
      }

      // Retry with exponential backoff
      const backoffMs = BACKOFF_DELAYS_MS[this.consecutiveFailures - 1];
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.performRefresh();
      }, backoffMs);
    }
  }
}

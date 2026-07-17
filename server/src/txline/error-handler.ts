/**
 * TxLINE Error Handler Module.
 *
 * Handles HTTP error responses from TxLINE API:
 *   - 401: JWT expired → re-acquire guest JWT, reconnect with same API token
 *   - 403: API token invalid → full re-activation flow (new JWT → subscribe → activate)
 *
 * The 403 re-activation retries up to 3 times with 5-second delays between attempts.
 * If all retries fail, emits 'activation_failed' so the caller can enter Replay Mode.
 */

import { EventEmitter } from 'node:events';
import { TxLINEAuth } from './auth.js';
import { TxLINEActivation } from './activation.js';

/** Maximum number of re-activation attempts on 403. */
const MAX_REACTIVATION_ATTEMPTS = 3;

/** Delay between re-activation attempts in milliseconds. */
const REACTIVATION_DELAY_MS = 5_000;

export interface ReactivationFailedEvent {
  attempts: number;
  lastError: string;
}

export type SubscribeFunction = () => Promise<string>;

export interface TxLINEErrorHandlerOptions {
  /**
   * Function that executes a new on-chain subscribe transaction and returns
   * the transaction signature. Required for 403 re-activation flow.
   */
  onSubscribe?: SubscribeFunction;
}

export class TxLINEErrorHandler extends EventEmitter {
  private auth: TxLINEAuth;
  private activation: TxLINEActivation;
  private onSubscribe?: SubscribeFunction;

  constructor(
    auth: TxLINEAuth,
    activation: TxLINEActivation,
    options?: TxLINEErrorHandlerOptions
  ) {
    super();
    this.auth = auth;
    this.activation = activation;
    this.onSubscribe = options?.onSubscribe;
  }

  /**
   * Handles a 401 (JWT expired) response.
   *
   * Re-acquires a guest JWT from TxLINE. The same API token remains valid;
   * the caller should reconnect SSE streams using the new JWT.
   *
   * @returns The new JWT string.
   * @throws If the JWT acquisition fails.
   */
  async handle401(): Promise<string> {
    const { jwt } = await this.auth.acquireGuestJWT();
    return jwt;
  }

  /**
   * Handles a 403 (API token invalid) response.
   *
   * Performs full re-activation: new JWT → new on-chain subscribe → activate API token.
   * Retries up to 3 times with 5-second delays between attempts.
   * If all attempts fail, emits 'activation_failed' event.
   *
   * @returns The new API token string on success, or null if all retries fail.
   */
  async handle403(): Promise<string | null> {
    let lastError = '';

    for (let attempt = 1; attempt <= MAX_REACTIVATION_ATTEMPTS; attempt++) {
      try {
        // Step 1: Acquire a fresh JWT
        await this.auth.acquireGuestJWT();

        // Step 2: Execute on-chain subscribe transaction
        if (!this.onSubscribe) {
          throw new Error(
            '[TxLINEErrorHandler] No onSubscribe function provided for re-activation.'
          );
        }
        const txSig = await this.onSubscribe();

        // Step 3: Activate API token with new credentials
        const apiToken = await this.activation.activateAPIToken(txSig);
        return apiToken;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);

        // Wait before next attempt (skip delay after the last attempt)
        if (attempt < MAX_REACTIVATION_ATTEMPTS) {
          await this.delay(REACTIVATION_DELAY_MS);
        }
      }
    }

    // All retries exhausted — emit failure event for Replay Mode fallback
    const failedEvent: ReactivationFailedEvent = {
      attempts: MAX_REACTIVATION_ATTEMPTS,
      lastError,
    };
    this.emit('activation_failed', failedEvent);

    return null;
  }

  /**
   * Determines whether a given HTTP status code is recoverable.
   *
   * @param statusCode The HTTP status code from a TxLINE API response.
   * @returns true for 401 (JWT expired) and 403 (token invalid), false otherwise.
   */
  isRecoverable(statusCode: number): boolean {
    return statusCode === 401 || statusCode === 403;
  }

  /**
   * Creates a promise that resolves after the specified delay.
   * Separated for testability (can be mocked with fake timers).
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

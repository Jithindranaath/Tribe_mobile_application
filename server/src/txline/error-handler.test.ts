import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TxLINEErrorHandler } from './error-handler.js';
import { TxLINEAuth } from './auth.js';
import { TxLINEActivation } from './activation.js';

// Mock the env config
vi.mock('../config/env.js', () => ({
  getEnvConfig: () => ({
    txlineApiBaseUrl: 'https://txline-dev.txodds.com/api',
    txlineWalletKeypair: JSON.stringify(Array.from({ length: 64 }, (_, i) => i)),
  }),
}));

describe('TxLINEErrorHandler', () => {
  let auth: TxLINEAuth;
  let activation: TxLINEActivation;
  let handler: TxLINEErrorHandler;

  beforeEach(() => {
    vi.useFakeTimers();
    auth = new TxLINEAuth();
    activation = new TxLINEActivation(auth);

    // Default mock: acquireGuestJWT succeeds
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jwt: 'fresh-jwt', expiresIn: 3600 }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('handle401', () => {
    it('acquires a new guest JWT and returns the token', async () => {
      handler = new TxLINEErrorHandler(auth, activation);

      const jwt = await handler.handle401();

      expect(jwt).toBe('fresh-jwt');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toContain('/auth/guest/start');
      expect(options.method).toBe('POST');
    });

    it('throws if JWT acquisition fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'server error',
      });

      handler = new TxLINEErrorHandler(auth, activation);

      await expect(handler.handle401()).rejects.toThrow('Failed to acquire guest JWT');
    });
  });

  describe('handle403', () => {
    it('performs full re-activation: new JWT → subscribe → activate token', async () => {
      // Mock activation.activateAPIToken to avoid ed25519 signing overhead
      vi.spyOn(activation, 'activateAPIToken').mockResolvedValue('new-api-token');

      const onSubscribe = vi.fn().mockResolvedValue('tx-sig-123');
      handler = new TxLINEErrorHandler(auth, activation, { onSubscribe });

      const result = await handler.handle403();

      expect(result).toBe('new-api-token');
      expect(global.fetch).toHaveBeenCalledTimes(1); // acquireGuestJWT
      expect(onSubscribe).toHaveBeenCalledTimes(1);
      expect(activation.activateAPIToken).toHaveBeenCalledWith('tx-sig-123');
    });

    it('retries up to 3 times with 5s delays on failure', async () => {
      let attempt = 0;

      // acquireGuestJWT: fails first 2 times, succeeds on 3rd
      global.fetch = vi.fn().mockImplementation(async () => {
        attempt++;
        if (attempt < 3) {
          return {
            ok: false,
            status: 500,
            statusText: 'Error',
            text: async () => 'fail',
          };
        }
        return {
          ok: true,
          json: async () => ({ jwt: 'recovered-jwt', expiresIn: 3600 }),
        };
      });

      vi.spyOn(activation, 'activateAPIToken').mockResolvedValue('recovered-token');
      const onSubscribe = vi.fn().mockResolvedValue('tx-sig-retry');
      handler = new TxLINEErrorHandler(auth, activation, { onSubscribe });

      const resultPromise = handler.handle403();

      // First attempt fails → waits 5s
      await vi.advanceTimersByTimeAsync(5_000);
      // Second attempt fails → waits 5s
      await vi.advanceTimersByTimeAsync(5_000);

      const result = await resultPromise;
      expect(result).toBe('recovered-token');
      expect(attempt).toBe(3);
    });

    it('emits activation_failed and returns null after 3 failed attempts', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'all fail',
      });

      const onSubscribe = vi.fn().mockResolvedValue('tx-sig-fail');
      handler = new TxLINEErrorHandler(auth, activation, { onSubscribe });

      const failHandler = vi.fn();
      handler.on('activation_failed', failHandler);

      const resultPromise = handler.handle403();

      // Advance through delay periods between attempts 1→2 and 2→3
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(5_000);

      const result = await resultPromise;

      expect(result).toBeNull();
      expect(failHandler).toHaveBeenCalledTimes(1);
      expect(failHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 3,
          lastError: expect.stringContaining('500'),
        })
      );
    });

    it('fails immediately if no onSubscribe function is provided', async () => {
      // acquireGuestJWT succeeds but onSubscribe is missing
      handler = new TxLINEErrorHandler(auth, activation);
      const failHandler = vi.fn();
      handler.on('activation_failed', failHandler);

      const resultPromise = handler.handle403();

      // Advance through delays between attempts
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(5_000);

      const result = await resultPromise;

      expect(result).toBeNull();
      expect(failHandler).toHaveBeenCalledTimes(1);
      expect(failHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 3,
          lastError: expect.stringContaining('No onSubscribe function provided'),
        })
      );
    });

    it('does not delay after the final failed attempt', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'unavailable',
      });

      const onSubscribe = vi.fn().mockResolvedValue('tx-sig');
      handler = new TxLINEErrorHandler(auth, activation, { onSubscribe });

      const failHandler = vi.fn();
      handler.on('activation_failed', failHandler);

      const resultPromise = handler.handle403();

      // Only 2 delays needed (between attempts 1→2 and 2→3)
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(5_000);

      const result = await resultPromise;
      expect(result).toBeNull();
      expect(failHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('isRecoverable', () => {
    beforeEach(() => {
      handler = new TxLINEErrorHandler(auth, activation);
    });

    it('returns true for 401 (JWT expired)', () => {
      expect(handler.isRecoverable(401)).toBe(true);
    });

    it('returns true for 403 (API token invalid)', () => {
      expect(handler.isRecoverable(403)).toBe(true);
    });

    it('returns false for 400 (bad request)', () => {
      expect(handler.isRecoverable(400)).toBe(false);
    });

    it('returns false for 404 (not found)', () => {
      expect(handler.isRecoverable(404)).toBe(false);
    });

    it('returns false for 500 (server error)', () => {
      expect(handler.isRecoverable(500)).toBe(false);
    });

    it('returns false for 200 (success)', () => {
      expect(handler.isRecoverable(200)).toBe(false);
    });
  });
});

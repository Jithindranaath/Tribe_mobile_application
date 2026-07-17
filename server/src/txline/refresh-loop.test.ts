import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JWTRefreshLoop } from './refresh-loop.js';
import { TxLINEAuth } from './auth.js';

// Mock the env config so TxLINEAuth doesn't throw
vi.mock('../config/env.js', () => ({
  getEnvConfig: () => ({
    txlineApiBaseUrl: 'https://txline-dev.txodds.com/api',
  }),
}));

describe('JWTRefreshLoop', () => {
  let auth: TxLINEAuth;
  let loop: JWTRefreshLoop;

  beforeEach(() => {
    vi.useFakeTimers();
    auth = new TxLINEAuth();
    // Mock fetch for acquireGuestJWT
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jwt: 'new-jwt-token', expiresIn: 3600 }),
    });
  });

  afterEach(() => {
    loop?.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('start / stop lifecycle', () => {
    it('marks the loop as running after start()', () => {
      loop = new JWTRefreshLoop(auth);
      loop.start();
      expect(loop.isRunning).toBe(true);
    });

    it('marks the loop as not running after stop()', () => {
      loop = new JWTRefreshLoop(auth);
      loop.start();
      loop.stop();
      expect(loop.isRunning).toBe(false);
    });

    it('is idempotent — calling start() twice does not double-schedule', () => {
      loop = new JWTRefreshLoop(auth);
      loop.start();
      loop.start(); // should be a no-op
      expect(loop.isRunning).toBe(true);
    });
  });

  describe('proactive refresh scheduling at 83% of lifetime', () => {
    it('refreshes immediately when no JWT is stored', async () => {
      const onRefresh = vi.fn();
      loop = new JWTRefreshLoop(auth, { onRefresh });
      loop.start();

      // Since no JWT exists, delay should be 0 — fires on next tick
      await vi.advanceTimersByTimeAsync(0);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(onRefresh).toHaveBeenCalledWith('new-jwt-token');
    });

    it('schedules refresh at 83% of remaining JWT lifetime', async () => {
      // First acquire a JWT so there's a known expiration
      vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
      await auth.acquireGuestJWT();

      // expiresIn = 3600s → remaining = 3600s from now
      // refresh delay = 3600 * 1000 * 0.83 = 2_988_000ms ≈ 49.8 minutes
      const onRefresh = vi.fn();
      loop = new JWTRefreshLoop(auth, { onRefresh });

      // Reset fetch mock call count
      vi.mocked(global.fetch).mockClear();

      loop.start();

      // Advance to just before the 83% mark — should NOT have refreshed
      await vi.advanceTimersByTimeAsync(2_987_000);
      expect(onRefresh).not.toHaveBeenCalled();

      // Advance past the 83% mark
      await vi.advanceTimersByTimeAsync(2_000);
      expect(onRefresh).toHaveBeenCalledWith('new-jwt-token');
    });

    it('reschedules after a successful refresh', async () => {
      vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
      await auth.acquireGuestJWT();

      const onRefresh = vi.fn();
      loop = new JWTRefreshLoop(auth, { onRefresh });
      vi.mocked(global.fetch).mockClear();

      loop.start();

      // First refresh fires at ~83% of 3600s remaining
      await vi.advanceTimersByTimeAsync(2_988_000);
      expect(onRefresh).toHaveBeenCalledTimes(1);

      // After refresh, a new JWT with expiresIn=3600 is stored.
      // Next refresh will be at 83% of 3600s = ~2988s from now.
      await vi.advanceTimersByTimeAsync(2_988_000);
      expect(onRefresh).toHaveBeenCalledTimes(2);
    });
  });

  describe('exponential backoff on refresh failure', () => {
    it('retries with backoff delays [1s, 2s, 4s, 8s, 16s]', async () => {
      const onRefresh = vi.fn();
      loop = new JWTRefreshLoop(auth, { onRefresh });

      // Make all fetch calls fail
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'error',
      });

      loop.start();

      // Attempt 1 fires immediately (no JWT stored → delay 0)
      await vi.advanceTimersByTimeAsync(0);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Retry 1 after 1s
      await vi.advanceTimersByTimeAsync(1_000);
      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Retry 2 after 2s
      await vi.advanceTimersByTimeAsync(2_000);
      expect(global.fetch).toHaveBeenCalledTimes(3);

      // Retry 3 after 4s
      await vi.advanceTimersByTimeAsync(4_000);
      expect(global.fetch).toHaveBeenCalledTimes(4);

      // Retry 4 after 8s
      await vi.advanceTimersByTimeAsync(8_000);
      expect(global.fetch).toHaveBeenCalledTimes(5);

      // After 5 total attempts, should not retry further
      expect(onRefresh).not.toHaveBeenCalled();
    });

    it('emits refresh_failed after 5 consecutive failures', async () => {
      loop = new JWTRefreshLoop(auth);
      const failHandler = vi.fn();
      loop.on('refresh_failed', failHandler);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'error',
      });

      loop.start();

      // Run through all 5 attempts: 0ms + 1s + 2s + 4s + 8s
      await vi.advanceTimersByTimeAsync(0);       // attempt 1
      await vi.advanceTimersByTimeAsync(1_000);   // attempt 2
      await vi.advanceTimersByTimeAsync(2_000);   // attempt 3
      await vi.advanceTimersByTimeAsync(4_000);   // attempt 4
      await vi.advanceTimersByTimeAsync(8_000);   // attempt 5

      expect(failHandler).toHaveBeenCalledTimes(1);
      expect(failHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 5,
          lastError: expect.stringContaining('500'),
        })
      );
      expect(loop.isRunning).toBe(false);
    });

    it('resets failure count after a successful refresh', async () => {
      const onRefresh = vi.fn();
      loop = new JWTRefreshLoop(auth, { onRefresh });

      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          // First 2 calls fail
          return {
            ok: false,
            status: 500,
            statusText: 'Error',
            text: async () => 'err',
          };
        }
        // Third call succeeds
        return {
          ok: true,
          json: async () => ({ jwt: 'recovered-jwt', expiresIn: 3600 }),
        };
      });

      loop.start();

      // Attempt 1 (fails)
      await vi.advanceTimersByTimeAsync(0);
      expect(onRefresh).not.toHaveBeenCalled();

      // Retry after 1s (fails)
      await vi.advanceTimersByTimeAsync(1_000);
      expect(onRefresh).not.toHaveBeenCalled();

      // Retry after 2s (succeeds)
      await vi.advanceTimersByTimeAsync(2_000);
      expect(onRefresh).toHaveBeenCalledWith('recovered-jwt');
      expect(loop.isRunning).toBe(true);
    });
  });

  describe('stop cancels pending timers', () => {
    it('does not fire refresh after stop()', async () => {
      vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
      await auth.acquireGuestJWT();

      const onRefresh = vi.fn();
      loop = new JWTRefreshLoop(auth, { onRefresh });
      vi.mocked(global.fetch).mockClear();

      loop.start();
      loop.stop();

      // Advance past when the refresh would have fired
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(onRefresh).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does not fire retry after stop()', async () => {
      loop = new JWTRefreshLoop(auth);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Error',
        text: async () => 'err',
      });

      loop.start();

      // First attempt fires (fails)
      await vi.advanceTimersByTimeAsync(0);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Stop before retry fires
      loop.stop();

      // Advance past retry delay — should not have called fetch again
      await vi.advanceTimersByTimeAsync(10_000);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});

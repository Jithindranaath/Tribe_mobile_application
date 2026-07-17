/**
 * Unit tests for TxLINE SSE Stream Manager.
 * Validates: Requirements 2.1, 2.2, 2.3, 2.9, 27.1
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TxLINEStreamManager } from './streams.js';
import { eventBus, ODDS_SHIFT_EVENT } from '../events/event-bus.js';
import type { OddsShiftEvent } from '../events/event-bus.js';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

const { mockInsert, mockFrom, mockNormalizeScoreEvent } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockResolvedValue({ error: null });
  const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });
  const mockNormalizeScoreEvent = vi.fn().mockResolvedValue(undefined);
  return { mockInsert, mockFrom, mockNormalizeScoreEvent };
});

vi.mock('../lib/supabase.js', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

vi.mock('../config/env.js', () => ({
  getEnvConfig: () => ({
    txlineApiBaseUrl: 'https://txline-test.example.com',
    supabaseUrl: 'https://test.supabase.co',
    supabaseServiceRoleKey: 'test-key',
  }),
}));

vi.mock('./normalizer.js', () => ({
  normalizeScoreEvent: (...args: unknown[]) => mockNormalizeScoreEvent(...args),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockActivation() {
  return {
    getAuthHeaders: vi.fn().mockReturnValue({
      Authorization: 'Bearer test-jwt-token',
      'X-Api-Token': 'test-api-token',
    }),
  } as any;
}

/**
 * Creates a ReadableStream that emits SSE-formatted data lines
 * but stays open (does not close) so the connection remains "active".
 */
function createSSEStreamThatStaysOpen(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = lines.join('\n') + '\n';
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(data));
      // Do NOT close — keep stream alive
    },
  });
}

/**
 * Creates a ReadableStream that emits SSE data and then closes.
 */
function createSSEStreamThatCloses(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = lines.join('\n') + '\n';
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(data));
      controller.close();
    },
  });
}

/** Flushes all pending microtasks/promises */
async function flushMicrotasks(): Promise<void> {
  // Multiple cycles to allow chained promises to resolve
  for (let i = 0; i < 10; i++) {
    await vi.advanceTimersByTimeAsync(1);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TxLINEStreamManager', () => {
  let manager: TxLINEStreamManager;
  let mockActivation: ReturnType<typeof createMockActivation>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockActivation = createMockActivation();
    manager = new TxLINEStreamManager(mockActivation);
    mockInsert.mockClear();
    mockFrom.mockClear();
    mockNormalizeScoreEvent.mockClear();
    eventBus.removeAllListeners();
  });

  afterEach(() => {
    manager.disconnect();
    eventBus.removeAllListeners();
    vi.useRealTimers();
  });

  // ─── Scores Stream Connection (Task 7.1) ─────────────────────────────────

  describe('connectScoresStream (Requirement 2.1, 2.3)', () => {
    it('fetches the correct URL with auth headers and gzip', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(createSSEStreamThatStaysOpen(['']), { status: 200 })
      );

      await manager.connectScoresStream();

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://txline-test.example.com/api/scores/stream',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-jwt-token',
            'X-Api-Token': 'test-api-token',
            'Accept-Encoding': 'gzip',
            Accept: 'text/event-stream',
          }),
        })
      );

      fetchSpy.mockRestore();
    });

    it('passes parsed JSON data to normalizeScoreEvent', async () => {
      const scoreEvent = JSON.stringify({
        fixtureId: '123',
        seq: 1,
        ts: 1700000000,
        gameState: '1H',
        homeScore: 1,
        awayScore: 0,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(createSSEStreamThatStaysOpen([`data: ${scoreEvent}`]), { status: 200 })
      );

      await manager.connectScoresStream();
      // Allow stream processing microtasks to complete
      await flushMicrotasks();

      expect(mockNormalizeScoreEvent).toHaveBeenCalledWith(
        JSON.parse(scoreEvent)
      );

      fetchSpy.mockRestore();
    });

    it('ignores empty data lines (heartbeats)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(createSSEStreamThatStaysOpen(['data:', 'data: ', '']), { status: 200 })
      );

      await manager.connectScoresStream();
      await flushMicrotasks();

      expect(mockNormalizeScoreEvent).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    });

    it('marks stream as connected on successful response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(createSSEStreamThatStaysOpen(['']), { status: 200 })
      );

      await manager.connectScoresStream();

      const status = manager.getStatus('scores');
      expect(status.connected).toBe(true);
      expect(status.reconnectAttempts).toBe(0);
      expect(status.lastConnectedAt).not.toBeNull();

      fetchSpy.mockRestore();
    });
  });

  // ─── Odds Stream Connection (Task 7.2) ───────────────────────────────────

  describe('connectOddsStream (Requirement 2.2, 2.3)', () => {
    it('fetches the correct URL with auth headers and gzip', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(createSSEStreamThatStaysOpen(['']), { status: 200 })
      );

      await manager.connectOddsStream();

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://txline-test.example.com/api/odds/stream',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-jwt-token',
            'X-Api-Token': 'test-api-token',
            'Accept-Encoding': 'gzip',
            Accept: 'text/event-stream',
          }),
        })
      );

      fetchSpy.mockRestore();
    });

    it('stores odds ticks in database', async () => {
      const oddsEvent = JSON.stringify({
        fixtureId: '456',
        ts: 1700000000,
        market: 'match_winner',
        prices: { home: 2.10, away: 3.50, draw: 3.20 },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(createSSEStreamThatStaysOpen([`data: ${oddsEvent}`]), { status: 200 })
      );

      await manager.connectOddsStream();
      await flushMicrotasks();

      expect(mockFrom).toHaveBeenCalledWith('odds_ticks');
      expect(mockInsert).toHaveBeenCalledWith({
        fixture_id: 456,
        ts: 1700000000,
        market: 'match_winner',
        price_json: { home: 2.10, away: 3.50, draw: 3.20 },
      });

      fetchSpy.mockRestore();
    });

    it('emits ODDS_SHIFT_EVENT when price changes exceed 15% within 60s', async () => {
      const oddsShifts: OddsShiftEvent[] = [];
      eventBus.on(ODDS_SHIFT_EVENT, (e) => oddsShifts.push(e));

      // First event at t=0, second event 30s later with 20% change
      const event1 = JSON.stringify({
        fixtureId: '456',
        ts: 1700000000,
        market: 'match_winner',
        prices: { home: 2.00 },
      });
      const event2 = JSON.stringify({
        fixtureId: '456',
        ts: 1700000000 + 30_000, // within 60s window
        market: 'match_winner',
        prices: { home: 2.40 }, // 20% change
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          createSSEStreamThatStaysOpen([`data: ${event1}`, `data: ${event2}`]),
          { status: 200 }
        )
      );

      await manager.connectOddsStream();
      await flushMicrotasks();

      expect(oddsShifts).toHaveLength(1);
      expect(oddsShifts[0]).toMatchObject({
        fixtureId: '456',
        market: 'match_winner',
        oldPrice: 2.00,
        newPrice: 2.40,
      });
      expect(oddsShifts[0].percentChange).toBeCloseTo(0.2);

      fetchSpy.mockRestore();
    });

    it('does NOT emit ODDS_SHIFT_EVENT when price change is below 15%', async () => {
      const oddsShifts: OddsShiftEvent[] = [];
      eventBus.on(ODDS_SHIFT_EVENT, (e) => oddsShifts.push(e));

      // 10% change (below threshold)
      const event1 = JSON.stringify({
        fixtureId: '456',
        ts: 1700000000,
        market: 'match_winner',
        prices: { home: 2.00 },
      });
      const event2 = JSON.stringify({
        fixtureId: '456',
        ts: 1700000000 + 30_000,
        market: 'match_winner',
        prices: { home: 2.20 }, // 10% change
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          createSSEStreamThatStaysOpen([`data: ${event1}`, `data: ${event2}`]),
          { status: 200 }
        )
      );

      await manager.connectOddsStream();
      await flushMicrotasks();

      expect(oddsShifts).toHaveLength(0);

      fetchSpy.mockRestore();
    });
  });

  // ─── Reconnection Logic (Task 7.3) ───────────────────────────────────────

  describe('Exponential backoff reconnection (Requirement 2.9, 27.1)', () => {
    it('schedules reconnection on connection failure with correct backoff delays', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('Connection refused')
      );

      await manager.connectScoresStream();

      // Initial attempt failed → 1 call so far, reconnect attempt #1 scheduled at 1s
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Advance 1s → second call (reconnect attempt 1)
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Advance 2s → third call (reconnect attempt 2)
      await vi.advanceTimersByTimeAsync(2_000);
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      // Advance 4s → fourth call (reconnect attempt 3)
      await vi.advanceTimersByTimeAsync(4_000);
      expect(fetchSpy).toHaveBeenCalledTimes(4);

      // Advance 8s → fifth call (reconnect attempt 4)
      await vi.advanceTimersByTimeAsync(8_000);
      expect(fetchSpy).toHaveBeenCalledTimes(5);

      // Advance 16s → sixth call (reconnect attempt 5)
      await vi.advanceTimersByTimeAsync(16_000);
      expect(fetchSpy).toHaveBeenCalledTimes(6);

      fetchSpy.mockRestore();
    });

    it('emits stream_failed event after 5 consecutive reconnect failures', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('Connection refused')
      );

      const failedEvents: Array<{ streamType: string; attempts: number }> = [];
      manager.on('stream_failed', (e) => failedEvents.push(e));

      await manager.connectScoresStream();

      // Run through all backoff delays: [1s, 2s, 4s, 8s, 16s]
      // Initial fail → schedule at 1s (attempts set to 1)
      await vi.advanceTimersByTimeAsync(1_000);   // reconnect 1 fires, fails → attempts = 2
      await vi.advanceTimersByTimeAsync(2_000);   // reconnect 2 fires, fails → attempts = 3
      await vi.advanceTimersByTimeAsync(4_000);   // reconnect 3 fires, fails → attempts = 4
      await vi.advanceTimersByTimeAsync(8_000);   // reconnect 4 fires, fails → attempts = 5
      await vi.advanceTimersByTimeAsync(16_000);  // reconnect 5 fires, fails → attempts = 5 >= MAX → emit

      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]).toEqual({
        streamType: 'scores',
        attempts: 5,
      });

      fetchSpy.mockRestore();
    });

    it('resets reconnect attempts on successful connection', async () => {
      let callCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error('Connection refused');
        }
        return new Response(createSSEStreamThatStaysOpen(['']), { status: 200 });
      });

      await manager.connectScoresStream();
      // First call fails → counter = 1, schedule at 1s

      await vi.advanceTimersByTimeAsync(1_000);
      // Second call fails → counter = 2, schedule at 2s

      await vi.advanceTimersByTimeAsync(2_000);
      // Third call succeeds → counter = 0, connected = true

      const status = manager.getStatus('scores');
      expect(status.connected).toBe(true);
      expect(status.reconnectAttempts).toBe(0);

      fetchSpy.mockRestore();
    });

    it('attempts reconnection when stream closes unexpectedly', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(createSSEStreamThatCloses(['data: {"test":1}']), { status: 200 })
      );

      await manager.connectScoresStream();
      // Stream data is processed, then stream closes → schedules reconnect
      await flushMicrotasks();

      // After stream closes, a reconnect is scheduled at 1s
      await vi.advanceTimersByTimeAsync(1_000);
      // Should have been called twice: initial + reconnect
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      fetchSpy.mockRestore();
    });

    it('does not attempt reconnection after disconnect() is called', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('Connection refused')
      );

      await manager.connectScoresStream();

      // One failure occurred, reconnect scheduled at 1s
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Disconnect cancels pending timers
      manager.disconnect();

      // Advance past all backoff delays
      await vi.advanceTimersByTimeAsync(50_000);

      // Only the initial call should have been made
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fetchSpy.mockRestore();
    });
  });

  // ─── Disconnect ──────────────────────────────────────────────────────────

  describe('disconnect()', () => {
    it('disconnects all active streams', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        // Return a new stream for each call
        return new Response(createSSEStreamThatStaysOpen(['']), { status: 200 });
      });

      await manager.connectScoresStream();
      await manager.connectOddsStream();

      expect(manager.getStatus('scores').connected).toBe(true);
      expect(manager.getStatus('odds').connected).toBe(true);

      manager.disconnect();

      expect(manager.getStatus('scores').connected).toBe(false);
      expect(manager.getStatus('odds').connected).toBe(false);

      fetchSpy.mockRestore();
    });
  });
});

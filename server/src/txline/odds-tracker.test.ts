/**
 * Unit tests for TxLINE Odds Shift Detection.
 * Validates: Requirements 2.8, 4.7
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OddsTracker } from './odds-tracker.js';
import {
  eventBus,
  ODDS_SHIFT_EVENT,
} from '../events/event-bus.js';
import type { OddsShiftEvent } from '../events/event-bus.js';

// ─── Mock Supabase ───────────────────────────────────────────────────────────

const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

vi.mock('../lib/supabase.js', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

// ─── Test Setup ──────────────────────────────────────────────────────────────

describe('OddsTracker', () => {
  let tracker: OddsTracker;

  beforeEach(() => {
    tracker = new OddsTracker();
    mockInsert.mockClear();
    mockFrom.mockClear();
    eventBus.removeAllListeners();
  });

  afterEach(() => {
    eventBus.removeAllListeners();
  });

  // ─── Storage ─────────────────────────────────────────────────────────────

  describe('odds_ticks persistence (Requirement 4.7)', () => {
    it('stores every odds tick in odds_ticks table', async () => {
      await tracker.processOddsTick('12345', 1700000000, 'match_winner', {
        home: 2.10,
        away: 3.50,
        draw: 3.20,
      });

      expect(mockFrom).toHaveBeenCalledWith('odds_ticks');
      expect(mockInsert).toHaveBeenCalledWith({
        fixture_id: 12345,
        ts: 1700000000,
        market: 'match_winner',
        price_json: { home: 2.10, away: 3.50, draw: 3.20 },
      });
    });

    it('does not throw when Supabase insert fails', async () => {
      mockInsert.mockResolvedValueOnce({ error: { message: 'DB error' } });

      await expect(
        tracker.processOddsTick('12345', 1700000000, 'match_winner', { home: 2.0 }),
      ).resolves.not.toThrow();
    });
  });

  // ─── Odds Shift Detection ────────────────────────────────────────────────

  describe('Odds shift detection (Requirement 2.8)', () => {
    it('emits ODDS_SHIFT_EVENT when price change exceeds 15%', async () => {
      const events: OddsShiftEvent[] = [];
      eventBus.on(ODDS_SHIFT_EVENT, (e) => events.push(e));

      // First tick at t=0
      await tracker.processOddsTick('12345', 1700000000, 'match_winner', { home: 2.00 });

      // Second tick at t=30s with >15% change (2.00 → 2.40 = 20% increase)
      await tracker.processOddsTick('12345', 1700000030, 'match_winner', { home: 2.40 });

      expect(events).toHaveLength(1);
      expect(events[0].fixtureId).toBe('12345');
      expect(events[0].timestamp).toBe(1700000030);
      expect(events[0].market).toBe('match_winner');
      expect(events[0].oldPrice).toBe(2.00);
      expect(events[0].newPrice).toBe(2.40);
      expect(events[0].percentChange).toBeCloseTo(0.2);
    });

    it('emits ODDS_SHIFT_EVENT for negative shifts exceeding -15%', async () => {
      const events: OddsShiftEvent[] = [];
      eventBus.on(ODDS_SHIFT_EVENT, (e) => events.push(e));

      // First tick
      await tracker.processOddsTick('12345', 1700000000, 'match_winner', { home: 3.00 });

      // Second tick with >15% decrease (3.00 → 2.40 = -20%)
      await tracker.processOddsTick('12345', 1700000030, 'match_winner', { home: 2.40 });

      expect(events).toHaveLength(1);
      expect(events[0].percentChange).toBeCloseTo(-0.2);
      expect(events[0].oldPrice).toBe(3.00);
      expect(events[0].newPrice).toBe(2.40);
    });

    it('does NOT emit ODDS_SHIFT_EVENT when price change is below 15%', async () => {
      const events: OddsShiftEvent[] = [];
      eventBus.on(ODDS_SHIFT_EVENT, (e) => events.push(e));

      // First tick
      await tracker.processOddsTick('12345', 1700000000, 'match_winner', { home: 2.00 });

      // Second tick with 10% change (below threshold)
      await tracker.processOddsTick('12345', 1700000030, 'match_winner', { home: 2.20 });

      expect(events).toHaveLength(0);
    });

    it('does NOT emit on the first tick (no reference price)', async () => {
      const events: OddsShiftEvent[] = [];
      eventBus.on(ODDS_SHIFT_EVENT, (e) => events.push(e));

      await tracker.processOddsTick('12345', 1700000000, 'match_winner', { home: 2.00 });

      expect(events).toHaveLength(0);
    });

    it('emits ODDS_SHIFT_EVENT at exactly 15.01% change (boundary)', async () => {
      const events: OddsShiftEvent[] = [];
      eventBus.on(ODDS_SHIFT_EVENT, (e) => events.push(e));

      await tracker.processOddsTick('12345', 1700000000, 'match_winner', { home: 1.00 });
      // 1.00 → 1.1501 = 15.01% change (just over threshold)
      await tracker.processOddsTick('12345', 1700000030, 'match_winner', { home: 1.1501 });

      expect(events).toHaveLength(1);
    });

    it('does NOT emit ODDS_SHIFT_EVENT at exactly 15% change (not strictly greater)', async () => {
      const events: OddsShiftEvent[] = [];
      eventBus.on(ODDS_SHIFT_EVENT, (e) => events.push(e));

      await tracker.processOddsTick('12345', 1700000000, 'match_winner', { home: 1.00 });
      // 1.00 → 1.15 = exactly 15% (not > 15%)
      await tracker.processOddsTick('12345', 1700000030, 'match_winner', { home: 1.15 });

      expect(events).toHaveLength(0);
    });
  });

  // ─── 60-Second Window Management ────────────────────────────────────────

  describe('60-second rolling window', () => {
    it('cleans up ticks older than 60 seconds', async () => {
      const events: OddsShiftEvent[] = [];
      eventBus.on(ODDS_SHIFT_EVENT, (e) => events.push(e));

      // Tick at t=0: price 2.00
      await tracker.processOddsTick('12345', 1700000000, 'match_winner', { home: 2.00 });

      // Tick at t=30s: price 2.10 (5% increase, within window)
      await tracker.processOddsTick('12345', 1700000030, 'match_winner', { home: 2.10 });

      // Tick at t=61s: first tick (t=0) is now expired
      // New oldest is t=30s with price 2.10
      // Change from 2.10 to 2.50 = ~19% → should emit
      await tracker.processOddsTick('12345', 1700000061, 'match_winner', { home: 2.50 });

      expect(events).toHaveLength(1);
      expect(events[0].oldPrice).toBe(2.10);
      expect(events[0].newPrice).toBe(2.50);
    });

    it('uses oldest price in window for comparison (not previous tick)', async () => {
      const events: OddsShiftEvent[] = [];
      eventBus.on(ODDS_SHIFT_EVENT, (e) => events.push(e));

      // Tick at t=0: price 2.00
      await tracker.processOddsTick('12345', 1700000000, 'match_winner', { home: 2.00 });

      // Tick at t=20s: price 2.05 (small increase)
      await tracker.processOddsTick('12345', 1700000020, 'match_winner', { home: 2.05 });

      // Tick at t=40s: price 2.35
      // Compared against oldest (t=0, price 2.00): (2.35-2.00)/2.00 = 17.5% → emit
      await tracker.processOddsTick('12345', 1700000040, 'match_winner', { home: 2.35 });

      expect(events).toHaveLength(1);
      expect(events[0].oldPrice).toBe(2.00);
      expect(events[0].newPrice).toBe(2.35);
    });

    it('tracks separate windows for different fixtures', async () => {
      const events: OddsShiftEvent[] = [];
      eventBus.on(ODDS_SHIFT_EVENT, (e) => events.push(e));

      // Fixture A at price 2.00
      await tracker.processOddsTick('A', 1700000000, 'match_winner', { home: 2.00 });
      // Fixture B at price 3.00
      await tracker.processOddsTick('B', 1700000000, 'match_winner', { home: 3.00 });

      // Fixture A shifts 20%
      await tracker.processOddsTick('A', 1700000030, 'match_winner', { home: 2.40 });

      expect(events).toHaveLength(1);
      expect(events[0].fixtureId).toBe('A');
    });

    it('tracks separate windows for different markets', async () => {
      const events: OddsShiftEvent[] = [];
      eventBus.on(ODDS_SHIFT_EVENT, (e) => events.push(e));

      // Same fixture, different markets
      await tracker.processOddsTick('12345', 1700000000, 'match_winner', { home: 2.00 });
      await tracker.processOddsTick('12345', 1700000000, 'next_goal', { home: 1.50 });

      // Only match_winner shifts
      await tracker.processOddsTick('12345', 1700000030, 'match_winner', { home: 2.40 });
      await tracker.processOddsTick('12345', 1700000030, 'next_goal', { home: 1.55 });

      expect(events).toHaveLength(1);
      expect(events[0].market).toBe('match_winner');
    });

    it('tracks separate windows for different outcomes within a market', async () => {
      const events: OddsShiftEvent[] = [];
      eventBus.on(ODDS_SHIFT_EVENT, (e) => events.push(e));

      // First tick: both home and draw prices
      await tracker.processOddsTick('12345', 1700000000, 'match_winner', {
        home: 2.00,
        draw: 3.20,
      });

      // Second tick: home shifts 20%, draw stays stable
      await tracker.processOddsTick('12345', 1700000030, 'match_winner', {
        home: 2.40,
        draw: 3.25,
      });

      // Only home triggered the event
      expect(events).toHaveLength(1);
      expect(events[0].newPrice).toBe(2.40);
    });

    it('handles oldPrice of zero without crashing', async () => {
      const events: OddsShiftEvent[] = [];
      eventBus.on(ODDS_SHIFT_EVENT, (e) => events.push(e));

      // Edge case: price starts at 0 (should not divide by zero)
      await tracker.processOddsTick('12345', 1700000000, 'match_winner', { home: 0 });
      await tracker.processOddsTick('12345', 1700000030, 'match_winner', { home: 2.00 });

      // Should not emit (avoid division by zero)
      expect(events).toHaveLength(0);
    });
  });

  // ─── Reset ─────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears all windows on reset', async () => {
      await tracker.processOddsTick('12345', 1700000000, 'match_winner', { home: 2.00 });
      expect(tracker.getWindow('12345', 'match_winner', 'home')).toBeDefined();

      tracker.reset();

      expect(tracker.getWindow('12345', 'match_winner', 'home')).toBeUndefined();
    });
  });
});

/**
 * Unit tests for the ReadResolver service and computeStandingDelta function.
 *
 * Tests cover:
 * - Task 15.1: Event subscription, pending read matching, resolution with txline_seq
 * - Task 15.4: Correct delta = base_points(100) × difficulty_multiplier × timing_bonus
 * - Task 15.6: Incorrect delta = -5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus, GOAL_EVENT, GoalEvent } from '../events/event-bus.js';
import { ReadResolver, computeStandingDelta } from './resolver.js';

// ─── Mock Supabase ───────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();

// Chain builder for query
function createChainableQuery(data: unknown[] | null, error: unknown | null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockImplementation(() => chain);
  // Final resolution: when all eq() calls are done, return data
  // We track eq calls and resolve after the third one for select, or second for update
  let eqCount = 0;
  chain.eq = vi.fn().mockImplementation(() => {
    eqCount++;
    // select has 3 eq() calls (fixture_id, read_type, status)
    // update has 1 eq() call (read_id)
    return chain;
  });

  // Override to return promise-like at end
  Object.defineProperty(chain, 'then', {
    get() {
      return (resolve: (value: unknown) => void) => resolve({ data, error });
    },
  });

  return chain;
}

// We'll mock at the module level
vi.mock('../lib/supabase.js', () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../lib/supabase.js';

// ─── computeStandingDelta Tests ──────────────────────────────────────────────

describe('computeStandingDelta', () => {
  describe('correct predictions (Task 15.4)', () => {
    it('should compute base_points(100) × difficulty_multiplier × timing_bonus', () => {
      // difficulty=1.0, secondsEarly=0 → timing_bonus=1.0 → 100*1*1 = 100
      expect(computeStandingDelta(true, 1.0, 0)).toBe(100);
    });

    it('should apply difficulty_multiplier correctly', () => {
      // difficulty=2.5, secondsEarly=0 → 100 * 2.5 * 1.0 = 250
      expect(computeStandingDelta(true, 2.5, 0)).toBe(250);
    });

    it('should compute timing_bonus = 1.0 + seconds_early/300', () => {
      // difficulty=1.0, secondsEarly=150 → timing_bonus=1.5 → 100*1*1.5 = 150
      expect(computeStandingDelta(true, 1.0, 150)).toBe(150);
    });

    it('should cap timing_bonus at 2.0', () => {
      // difficulty=1.0, secondsEarly=600 → timing_bonus would be 3.0 but capped at 2.0 → 100*1*2 = 200
      expect(computeStandingDelta(true, 1.0, 600)).toBe(200);
    });

    it('should cap timing_bonus at 2.0 for exactly 300 seconds early', () => {
      // secondsEarly=300 → timing_bonus = 1.0 + 300/300 = 2.0 (exactly at cap)
      expect(computeStandingDelta(true, 1.0, 300)).toBe(200);
    });

    it('should combine difficulty and timing multipliers', () => {
      // difficulty=3.0, secondsEarly=150 → timing_bonus=1.5 → 100*3*1.5 = 450
      expect(computeStandingDelta(true, 3.0, 150)).toBe(450);
    });

    it('should round result to nearest integer', () => {
      // difficulty=1.5, secondsEarly=100 → timing_bonus=1.333... → 100*1.5*1.333 = 200
      expect(computeStandingDelta(true, 1.5, 100)).toBe(200);
    });

    it('should handle max difficulty (5.0) with max timing bonus (2.0)', () => {
      // difficulty=5.0, secondsEarly=500 → timing_bonus capped at 2.0 → 100*5*2 = 1000
      expect(computeStandingDelta(true, 5.0, 500)).toBe(1000);
    });

    it('should handle minimum difficulty (1.0) with zero timing', () => {
      expect(computeStandingDelta(true, 1.0, 0)).toBe(100);
    });
  });

  describe('incorrect predictions (Task 15.6)', () => {
    it('should return -5 for incorrect predictions', () => {
      expect(computeStandingDelta(false, 1.0, 0)).toBe(-5);
    });

    it('should return -5 regardless of difficulty_multiplier', () => {
      expect(computeStandingDelta(false, 5.0, 0)).toBe(-5);
    });

    it('should return -5 regardless of seconds_early', () => {
      expect(computeStandingDelta(false, 1.0, 300)).toBe(-5);
    });

    it('should return -5 regardless of both multipliers', () => {
      expect(computeStandingDelta(false, 3.5, 200)).toBe(-5);
    });
  });
});

// ─── ReadResolver Class Tests ────────────────────────────────────────────────

describe('ReadResolver', () => {
  let bus: EventBus;
  let resolver: ReadResolver;

  beforeEach(() => {
    bus = new EventBus();
    resolver = new ReadResolver(bus);
    vi.clearAllMocks();
  });

  afterEach(() => {
    resolver.stop();
  });

  describe('start / stop (Task 15.1)', () => {
    it('should subscribe to GOAL_EVENT on start', () => {
      resolver.start();
      expect(bus.listenerCount(GOAL_EVENT)).toBe(1);
    });

    it('should unsubscribe from GOAL_EVENT on stop', () => {
      resolver.start();
      expect(bus.listenerCount(GOAL_EVENT)).toBe(1);
      resolver.stop();
      expect(bus.listenerCount(GOAL_EVENT)).toBe(0);
    });

    it('should handle stop without start gracefully', () => {
      expect(() => resolver.stop()).not.toThrow();
    });
  });

  describe('resolveReadsForEvent (Task 15.1)', () => {
    const goalEvent: GoalEvent = {
      fixtureId: 'fixture-123',
      seq: 42,
      timestamp: Date.now(),
      gameState: '1H',
      team: 'home',
    };

    it('should return empty array when no pending reads found', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      });

      vi.mocked(getSupabaseClient).mockReturnValue({ from: mockFrom } as any);

      const resolutions = await resolver.resolveReadsForEvent(goalEvent);
      expect(resolutions).toEqual([]);
    });

    it('should return empty array on query error', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
            }),
          }),
        }),
      });

      vi.mocked(getSupabaseClient).mockReturnValue({ from: mockFrom } as any);

      const resolutions = await resolver.resolveReadsForEvent(goalEvent);
      expect(resolutions).toEqual([]);
    });

    it('should resolve correct reads with proper standing delta', async () => {
      const committedAt = new Date(goalEvent.timestamp - 60000).toISOString(); // 60s early
      const pendingRead = {
        read_id: 'read-1',
        fan_id: 'fan-1',
        fixture_id: 'fixture-123',
        read_type: 'moment_read',
        predicted: 1, // predicted "yes goal"
        odds_at_commit: 2.0,
        committed_at: committedAt,
        status: 'pending',
        resolved: null,
        txline_seq: null,
        standing_delta: null,
        created_at: committedAt,
      };

      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'reads_live') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: [pendingRead], error: null }),
                }),
              }),
            }),
            update: updateMock,
          };
        }
        return {};
      });

      vi.mocked(getSupabaseClient).mockReturnValue({ from: mockFrom } as any);

      const resolutions = await resolver.resolveReadsForEvent(goalEvent);

      expect(resolutions).toHaveLength(1);
      expect(resolutions[0].fanId).toBe('fan-1');
      expect(resolutions[0].readId).toBe('read-1');
      expect(resolutions[0].correct).toBe(true);
      expect(resolutions[0].txLineSeq).toBe(42);
      // 60s early: timing_bonus = 1 + 60/300 = 1.2; delta = 100 * 2.0 * 1.2 = 240
      expect(resolutions[0].standingDelta).toBe(240);
    });

    it('should resolve incorrect reads with -5 delta', async () => {
      const committedAt = new Date(goalEvent.timestamp - 30000).toISOString(); // 30s early
      const pendingRead = {
        read_id: 'read-2',
        fan_id: 'fan-2',
        fixture_id: 'fixture-123',
        read_type: 'moment_read',
        predicted: 0, // predicted "no goal"
        odds_at_commit: 3.0,
        committed_at: committedAt,
        status: 'pending',
        resolved: null,
        txline_seq: null,
        standing_delta: null,
        created_at: committedAt,
      };

      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'reads_live') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: [pendingRead], error: null }),
                }),
              }),
            }),
            update: updateMock,
          };
        }
        return {};
      });

      vi.mocked(getSupabaseClient).mockReturnValue({ from: mockFrom } as any);

      const resolutions = await resolver.resolveReadsForEvent(goalEvent);

      expect(resolutions).toHaveLength(1);
      expect(resolutions[0].correct).toBe(false);
      expect(resolutions[0].standingDelta).toBe(-5);
      expect(resolutions[0].txLineSeq).toBe(42);
    });

    it('should store txline_seq from the resolving event', async () => {
      const committedAt = new Date(goalEvent.timestamp - 10000).toISOString();
      const pendingRead = {
        read_id: 'read-3',
        fan_id: 'fan-3',
        fixture_id: 'fixture-123',
        read_type: 'moment_read',
        predicted: 1,
        odds_at_commit: 1.5,
        committed_at: committedAt,
        status: 'pending',
        resolved: null,
        txline_seq: null,
        standing_delta: null,
        created_at: committedAt,
      };

      let capturedUpdate: Record<string, unknown> | null = null;
      const updateMock = vi.fn().mockImplementation((updateData: Record<string, unknown>) => {
        capturedUpdate = updateData;
        return {
          eq: vi.fn().mockResolvedValue({ error: null }),
        };
      });

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'reads_live') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: [pendingRead], error: null }),
                }),
              }),
            }),
            update: updateMock,
          };
        }
        return {};
      });

      vi.mocked(getSupabaseClient).mockReturnValue({ from: mockFrom } as any);

      await resolver.resolveReadsForEvent(goalEvent);

      expect(updateMock).toHaveBeenCalledWith({
        resolved: 1,
        txline_seq: 42,
        status: 'resolved',
        standing_delta: expect.any(Number),
      });
    });

    it('should resolve multiple pending reads for same fixture', async () => {
      const committedAt = new Date(goalEvent.timestamp - 20000).toISOString();
      const pendingReads = [
        {
          read_id: 'read-a',
          fan_id: 'fan-a',
          fixture_id: 'fixture-123',
          read_type: 'moment_read',
          predicted: 1,
          odds_at_commit: 2.0,
          committed_at: committedAt,
          status: 'pending',
          resolved: null,
          txline_seq: null,
          standing_delta: null,
          created_at: committedAt,
        },
        {
          read_id: 'read-b',
          fan_id: 'fan-b',
          fixture_id: 'fixture-123',
          read_type: 'moment_read',
          predicted: 0,
          odds_at_commit: 2.0,
          committed_at: committedAt,
          status: 'pending',
          resolved: null,
          txline_seq: null,
          standing_delta: null,
          created_at: committedAt,
        },
      ];

      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'reads_live') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: pendingReads, error: null }),
                }),
              }),
            }),
            update: updateMock,
          };
        }
        return {};
      });

      vi.mocked(getSupabaseClient).mockReturnValue({ from: mockFrom } as any);

      const resolutions = await resolver.resolveReadsForEvent(goalEvent);

      expect(resolutions).toHaveLength(2);
      expect(resolutions[0].correct).toBe(true);
      expect(resolutions[0].standingDelta).toBeGreaterThan(0);
      expect(resolutions[1].correct).toBe(false);
      expect(resolutions[1].standingDelta).toBe(-5);
    });

    it('should skip reads with update errors but continue processing', async () => {
      const committedAt = new Date(goalEvent.timestamp - 10000).toISOString();
      const pendingReads = [
        {
          read_id: 'read-fail',
          fan_id: 'fan-fail',
          fixture_id: 'fixture-123',
          read_type: 'moment_read',
          predicted: 1,
          odds_at_commit: 1.0,
          committed_at: committedAt,
          status: 'pending',
          resolved: null,
          txline_seq: null,
          standing_delta: null,
          created_at: committedAt,
        },
        {
          read_id: 'read-ok',
          fan_id: 'fan-ok',
          fixture_id: 'fixture-123',
          read_type: 'moment_read',
          predicted: 1,
          odds_at_commit: 1.0,
          committed_at: committedAt,
          status: 'pending',
          resolved: null,
          txline_seq: null,
          standing_delta: null,
          created_at: committedAt,
        },
      ];

      let callCount = 0;
      const updateMock = vi.fn().mockImplementation(() => {
        callCount++;
        return {
          eq: vi.fn().mockResolvedValue(
            callCount === 1
              ? { error: { message: 'Update failed' } }
              : { error: null }
          ),
        };
      });

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'reads_live') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: pendingReads, error: null }),
                }),
              }),
            }),
            update: updateMock,
          };
        }
        return {};
      });

      vi.mocked(getSupabaseClient).mockReturnValue({ from: mockFrom } as any);

      const resolutions = await resolver.resolveReadsForEvent(goalEvent);

      // First read fails update, second succeeds
      expect(resolutions).toHaveLength(1);
      expect(resolutions[0].readId).toBe('read-ok');
    });

    it('should use default difficulty_multiplier of 1.0 when odds_at_commit is null', async () => {
      const committedAt = new Date(goalEvent.timestamp - 60000).toISOString();
      const pendingRead = {
        read_id: 'read-noOdds',
        fan_id: 'fan-noOdds',
        fixture_id: 'fixture-123',
        read_type: 'moment_read',
        predicted: 1,
        odds_at_commit: null, // no odds available
        committed_at: committedAt,
        status: 'pending',
        resolved: null,
        txline_seq: null,
        standing_delta: null,
        created_at: committedAt,
      };

      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'reads_live') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: [pendingRead], error: null }),
                }),
              }),
            }),
            update: updateMock,
          };
        }
        return {};
      });

      vi.mocked(getSupabaseClient).mockReturnValue({ from: mockFrom } as any);

      const resolutions = await resolver.resolveReadsForEvent(goalEvent);

      // 60s early, difficulty=1.0: timing_bonus=1.2 → 100*1.0*1.2 = 120
      expect(resolutions[0].standingDelta).toBe(120);
    });
  });

  describe('event-driven resolution (Task 15.1)', () => {
    it('should trigger resolution when GOAL_EVENT is emitted', async () => {
      const committedAt = new Date(Date.now() - 30000).toISOString();
      const pendingRead = {
        read_id: 'read-auto',
        fan_id: 'fan-auto',
        fixture_id: 'fixture-999',
        read_type: 'moment_read',
        predicted: 1,
        odds_at_commit: 1.0,
        committed_at: committedAt,
        status: 'pending',
        resolved: null,
        txline_seq: null,
        standing_delta: null,
        created_at: committedAt,
      };

      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'reads_live') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: [pendingRead], error: null }),
                }),
              }),
            }),
            update: updateMock,
          };
        }
        return {};
      });

      vi.mocked(getSupabaseClient).mockReturnValue({ from: mockFrom } as any);

      resolver.start();

      // Emit a goal event — the resolver should handle it
      bus.emit(GOAL_EVENT, {
        fixtureId: 'fixture-999',
        seq: 77,
        timestamp: Date.now(),
        gameState: '2H',
        team: 'away',
      });

      // Allow async handler to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify the update was called (meaning resolution occurred)
      expect(updateMock).toHaveBeenCalled();
    });
  });
});

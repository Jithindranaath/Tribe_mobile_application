/**
 * Unit tests for the Titles service — Seer title grant logic.
 *
 * Tests cover:
 * - Task 21.1: Seer title grant check after settlement
 * - checkSeerTitle: accuracy > 0.75 AND total >= 20
 * - grantSeerTitle: sets bitmask correctly
 * - hasSeerTitle: detects existing grant
 * - checkAndGrantSeerTitle: end-to-end hook
 *
 * Requirements: 16.1
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SEER_BITMASK,
  SEER_ACCURACY_THRESHOLD,
  SEER_MIN_READS,
  grantSeerTitle,
  hasSeerTitle,
  getTitleBitmask,
  checkAndGrantSeerTitle,
  checkSeerTitle,
  _resetTitleStore,
} from './titles.js';

// ─── Mock Supabase ───────────────────────────────────────────────────────────

// Mock the supabase module so we can control query results
vi.mock('../lib/supabase.js', () => {
  return {
    getSupabaseClient: vi.fn(),
  };
});

import { getSupabaseClient } from '../lib/supabase.js';

// ─── Mock fans/onchain/standing-cache ────────────────────────────────────────
//
// grantSeerTitle now calls the on-chain grant_title instruction (looking up
// the fan's wallet via getFanById) and updates the cached_titles cache — mock
// all three so the "Seer" describe blocks below can stay focused on the
// bitmask/idempotence logic without needing real Supabase/Solana calls.

vi.mock('./fans.js', () => ({
  getFanById: vi.fn().mockResolvedValue({ fan_id: 'fan-1', wallet_pubkey: '11111111111111111111111111111111' }),
}));
vi.mock('./onchain.js', () => ({
  grantTitleOnChain: vi.fn().mockResolvedValue({ txSignature: 'mock-sig' }),
}));
vi.mock('./standing-cache.js', () => ({
  setCachedFanTitles: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Helper: creates a mock supabase client that returns specified counts.
 * Simulates the chained query builder pattern.
 */
function mockSupabaseWithCounts(totalCount: number, correctCount: number) {
  let callIndex = 0;

  const mockClient = {
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.in = () => builder;
      builder.gt = () => {
        // The .gt() call distinguishes the "correct reads" query
        // from the "total reads" query
        callIndex++;
        return builder;
      };

      // Intercept the terminal await — return different counts based on call
      // The first resolution (no .gt()) returns totalCount
      // The second (with .gt()) returns correctCount
      const originalThen = Promise.resolve().then;
      Object.defineProperty(builder, 'then', {
        get() {
          if (callIndex === 0) {
            // First query: total count (hasn't hit .gt() yet so callIndex is still 0)
            callIndex++;
            return (resolve: (value: { count: number; error: null }) => void) =>
              resolve({ count: totalCount, error: null });
          } else {
            // Second query: correct count (hit .gt())
            return (resolve: (value: { count: number; error: null }) => void) =>
              resolve({ count: correctCount, error: null });
          }
        },
      });

      return builder;
    },
  };

  (getSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(mockClient);
}

/**
 * More precise mock that tracks the two separate supabase calls.
 */
function mockSupabaseCalls(totalCount: number | null, correctCount: number | null, errors?: { totalError?: string; correctError?: string }) {
  let queryCount = 0;

  const createQueryBuilder = () => {
    let hasGt = false;

    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      gt: () => {
        hasGt = true;
        return builder;
      },
      then: undefined as unknown,
    };

    Object.defineProperty(builder, 'then', {
      get() {
        queryCount++;
        if (!hasGt) {
          // Total reads query
          if (errors?.totalError) {
            return (resolve: (v: unknown) => void) =>
              resolve({ count: null, error: { message: errors.totalError } });
          }
          return (resolve: (v: unknown) => void) =>
            resolve({ count: totalCount, error: null });
        } else {
          // Correct reads query
          if (errors?.correctError) {
            return (resolve: (v: unknown) => void) =>
              resolve({ count: null, error: { message: errors.correctError } });
          }
          return (resolve: (v: unknown) => void) =>
            resolve({ count: correctCount, error: null });
        }
      },
    });

    return builder;
  };

  const mockClient = {
    from: () => createQueryBuilder(),
  };

  (getSupabaseClient as ReturnType<typeof vi.fn>).mockReturnValue(mockClient);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Titles Service — Seer', () => {
  beforeEach(() => {
    _resetTitleStore();
    vi.clearAllMocks();
  });

  describe('Constants', () => {
    it('SEER_BITMASK should be 0x01', () => {
      expect(SEER_BITMASK).toBe(0x01);
    });

    it('SEER_ACCURACY_THRESHOLD should be 0.75', () => {
      expect(SEER_ACCURACY_THRESHOLD).toBe(0.75);
    });

    it('SEER_MIN_READS should be 20', () => {
      expect(SEER_MIN_READS).toBe(20);
    });
  });

  describe('grantSeerTitle()', () => {
    it('should grant Seer title to a fan', async () => {
      await grantSeerTitle('fan-1');
      expect(hasSeerTitle('fan-1')).toBe(true);
    });

    it('should set the correct bitmask bit', async () => {
      await grantSeerTitle('fan-1');
      expect(getTitleBitmask('fan-1')).toBe(SEER_BITMASK);
    });

    it('should be idempotent — granting twice does not change bitmask', async () => {
      await grantSeerTitle('fan-1');
      await grantSeerTitle('fan-1');
      expect(getTitleBitmask('fan-1')).toBe(SEER_BITMASK);
    });

    it('should not affect other fans', async () => {
      await grantSeerTitle('fan-1');
      expect(hasSeerTitle('fan-2')).toBe(false);
    });
  });

  describe('hasSeerTitle()', () => {
    it('should return false for a fan with no titles', () => {
      expect(hasSeerTitle('fan-unknown')).toBe(false);
    });

    it('should return true after grant', async () => {
      await grantSeerTitle('fan-1');
      expect(hasSeerTitle('fan-1')).toBe(true);
    });
  });

  describe('getTitleBitmask()', () => {
    it('should return 0 for a fan with no titles', () => {
      expect(getTitleBitmask('fan-none')).toBe(0);
    });

    it('should return SEER_BITMASK after Seer grant', async () => {
      await grantSeerTitle('fan-1');
      expect(getTitleBitmask('fan-1')).toBe(0x01);
    });
  });

  describe('checkSeerTitle()', () => {
    it('should return true when accuracy > 0.75 and total >= 20', async () => {
      mockSupabaseCalls(20, 16); // 16/20 = 0.80 > 0.75
      const result = await checkSeerTitle('fan-1');
      expect(result).toBe(true);
    });

    it('should return false when total < 20', async () => {
      mockSupabaseCalls(19, 15); // 15/19 = 0.79 but total < 20
      const result = await checkSeerTitle('fan-1');
      expect(result).toBe(false);
    });

    it('should return false when accuracy <= 0.75', async () => {
      mockSupabaseCalls(20, 15); // 15/20 = 0.75 (not strictly greater than)
      const result = await checkSeerTitle('fan-1');
      expect(result).toBe(false);
    });

    it('should return true at exact boundary: 76% accuracy with 20 reads', async () => {
      // 16/20 = 0.80 > 0.75 ✓ and total=20 >= 20 ✓
      mockSupabaseCalls(20, 16);
      const result = await checkSeerTitle('fan-1');
      expect(result).toBe(true);
    });

    it('should return false on DB error for total count', async () => {
      mockSupabaseCalls(null, null, { totalError: 'Connection failed' });
      const result = await checkSeerTitle('fan-1');
      expect(result).toBe(false);
    });

    it('should return false on DB error for correct count', async () => {
      mockSupabaseCalls(25, null, { correctError: 'Connection failed' });
      const result = await checkSeerTitle('fan-1');
      expect(result).toBe(false);
    });

    it('should return true for high accuracy with many reads', async () => {
      mockSupabaseCalls(100, 90); // 90/100 = 0.90 > 0.75
      const result = await checkSeerTitle('fan-1');
      expect(result).toBe(true);
    });

    it('should return false when total is 0', async () => {
      mockSupabaseCalls(0, 0); // 0 < 20
      const result = await checkSeerTitle('fan-1');
      expect(result).toBe(false);
    });
  });

  describe('checkAndGrantSeerTitle()', () => {
    it('should grant Seer when fan qualifies and does not already have it', async () => {
      mockSupabaseCalls(25, 20); // 20/25 = 0.80 > 0.75
      const granted = await checkAndGrantSeerTitle('fan-1');
      expect(granted).toBe(true);
      expect(hasSeerTitle('fan-1')).toBe(true);
    });

    it('should return false if fan already has Seer title', async () => {
      await grantSeerTitle('fan-1');
      // Should not even query the DB
      const granted = await checkAndGrantSeerTitle('fan-1');
      expect(granted).toBe(false);
    });

    it('should return false if fan does not qualify', async () => {
      mockSupabaseCalls(20, 14); // 14/20 = 0.70 < 0.75
      const granted = await checkAndGrantSeerTitle('fan-1');
      expect(granted).toBe(false);
      expect(hasSeerTitle('fan-1')).toBe(false);
    });

    it('should not grant on DB errors', async () => {
      mockSupabaseCalls(null, null, { totalError: 'Timeout' });
      const granted = await checkAndGrantSeerTitle('fan-1');
      expect(granted).toBe(false);
      expect(hasSeerTitle('fan-1')).toBe(false);
    });
  });

  describe('_resetTitleStore()', () => {
    it('should clear all granted titles', async () => {
      await grantSeerTitle('fan-1');
      await grantSeerTitle('fan-2');
      _resetTitleStore();
      expect(hasSeerTitle('fan-1')).toBe(false);
      expect(hasSeerTitle('fan-2')).toBe(false);
    });
  });
});

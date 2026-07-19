/**
 * Unit tests for the SettlementExecutor service.
 *
 * Tests cover:
 * - Task 16.8: Retry up to 3 times with increasing priority fees [1.2×, 1.5×, 2.0×]
 * - Task 16.8: On final failure: log error + alert operators; never surface error to fan
 * - Requirements: 27.4, 27.5
 *
 * `attemptSettlement` is injected (same dependency-injection pattern used by
 * ReplayManager elsewhere in this codebase) so these tests control success/
 * failure deterministically without touching the real chain. The default
 * (uninjected) implementation is real and calls services/onchain.ts —
 * verified separately via the live on-chain smoke test, not here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SettlementExecutor,
  PRIORITY_FEE_MULTIPLIERS,
  MAX_RETRIES,
  BASE_PRIORITY_FEE,
  type AttemptSettlementFn,
} from './settler.js';
import type { Resolution } from './resolver.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createResolution(overrides?: Partial<Resolution>): Resolution {
  return {
    fanId: `fan-${Math.random().toString(36).slice(2, 8)}`,
    readId: `read-${Math.random().toString(36).slice(2, 8)}`,
    correct: true,
    standingDelta: 150,
    txLineSeq: 42,
    fixtureId: 'fixture-123',
    readType: 'moment_read',
    predicted: 1,
    resolved: 1,
    ...overrides,
  };
}

function createBatch(size: number): Resolution[] {
  return Array.from({ length: size }, () => createResolution());
}

/** Always succeeds with a fixed tx signature. */
function alwaysSucceeds(txSignature = 'tx-sig-123'): AttemptSettlementFn {
  return async () => txSignature;
}

/** Always throws. */
function alwaysFails(message = 'simulated failure'): AttemptSettlementFn {
  return async () => {
    throw new Error(message);
  };
}

/** Fails N times then succeeds. */
function failsThenSucceeds(failCount: number, txSignature = 'tx-sig-final'): AttemptSettlementFn {
  let calls = 0;
  return async () => {
    calls++;
    if (calls <= failCount) {
      throw new Error(`simulated failure ${calls}`);
    }
    return txSignature;
  };
}

// ─── Constants Tests ─────────────────────────────────────────────────────────

describe('Settlement constants', () => {
  it('should have exactly 3 priority fee multipliers', () => {
    expect(PRIORITY_FEE_MULTIPLIERS).toHaveLength(3);
  });

  it('should use multipliers 1.2, 1.5, 2.0', () => {
    expect(PRIORITY_FEE_MULTIPLIERS[0]).toBe(1.2);
    expect(PRIORITY_FEE_MULTIPLIERS[1]).toBe(1.5);
    expect(PRIORITY_FEE_MULTIPLIERS[2]).toBe(2.0);
  });

  it('should have MAX_RETRIES = 3', () => {
    expect(MAX_RETRIES).toBe(3);
  });

  it('should define a BASE_PRIORITY_FEE', () => {
    expect(BASE_PRIORITY_FEE).toBeGreaterThan(0);
  });
});

// ─── SettlementExecutor Tests ────────────────────────────────────────────────

describe('SettlementExecutor', () => {
  let executor: SettlementExecutor;

  describe('successful settlement on first attempt', () => {
    beforeEach(() => {
      executor = new SettlementExecutor({ attemptSettlement: alwaysSucceeds() });
    });

    it('should settle a batch successfully', async () => {
      const batch = createBatch(5);
      const result = await executor.executeBatch(batch);

      expect(result.success).toBe(true);
      expect(result.txSignature).toBeDefined();
      expect(result.attempt).toBe(1);
      expect(result.priorityFeeMultiplier).toBe(1.0);
    });

    it('should fire onSettled callback on success', async () => {
      const onSettled = vi.fn();
      executor.setOnSettled(onSettled);

      const batch = createBatch(3);
      await executor.executeBatch(batch);

      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(onSettled).toHaveBeenCalledWith(batch, expect.any(String));
    });

    it('should not fire onFailed callback on success', async () => {
      const onFailed = vi.fn();
      executor.setOnFailed(onFailed);

      const batch = createBatch(3);
      await executor.executeBatch(batch);

      expect(onFailed).not.toHaveBeenCalled();
    });

    it('should handle empty batch gracefully', async () => {
      const result = await executor.executeBatch([]);

      expect(result.success).toBe(true);
      expect(result.attempt).toBe(0);
    });

    it('should not record failed batches on success', async () => {
      const batch = createBatch(2);
      await executor.executeBatch(batch);

      expect(executor.getFailedBatches()).toHaveLength(0);
    });
  });

  describe('retry logic (Requirement 27.4)', () => {
    it('should retry up to 3 times before giving up', async () => {
      executor = new SettlementExecutor({ attemptSettlement: alwaysFails() });

      const batch = createBatch(2);
      const result = await executor.executeBatch(batch);

      expect(result.success).toBe(false);
      // 1 initial + 3 retries = 4 attempts total
      expect(result.attempt).toBe(MAX_RETRIES + 1);
    });

    it('should use increasing priority fee multipliers on retries', async () => {
      // Fail first 3 attempts (initial + 1.2× + 1.5×), succeed on 4th (2.0×)
      executor = new SettlementExecutor({ attemptSettlement: failsThenSucceeds(3) });

      const batch = createBatch(2);
      const result = await executor.executeBatch(batch);

      expect(result.success).toBe(true);
      expect(result.priorityFeeMultiplier).toBe(2.0);
    });

    it('should succeed on first retry (1.2× multiplier)', async () => {
      executor = new SettlementExecutor({ attemptSettlement: failsThenSucceeds(1) });

      const batch = createBatch(2);
      const result = await executor.executeBatch(batch);

      expect(result.success).toBe(true);
      expect(result.priorityFeeMultiplier).toBe(1.2);
    });

    it('should succeed on second retry (1.5× multiplier)', async () => {
      executor = new SettlementExecutor({ attemptSettlement: failsThenSucceeds(2) });

      const batch = createBatch(2);
      const result = await executor.executeBatch(batch);

      expect(result.success).toBe(true);
      expect(result.priorityFeeMultiplier).toBe(1.5);
    });

    it('should pass an increasing priority fee to each attempt', async () => {
      const seenFees: number[] = [];
      executor = new SettlementExecutor({
        attemptSettlement: async (_batch, priorityFeeMicroLamports) => {
          seenFees.push(priorityFeeMicroLamports);
          if (seenFees.length <= 2) throw new Error('fail');
          return 'tx-sig';
        },
      });

      await executor.executeBatch(createBatch(1));

      expect(seenFees).toEqual([
        BASE_PRIORITY_FEE * 1.0,
        Math.round(BASE_PRIORITY_FEE * 1.2),
        Math.round(BASE_PRIORITY_FEE * 1.5),
      ]);
    });
  });

  describe('final failure handling (Requirement 27.5)', () => {
    beforeEach(() => {
      executor = new SettlementExecutor({ attemptSettlement: alwaysFails() });
    });

    it('should never throw on final failure (silent to fans)', async () => {
      const batch = createBatch(5);

      await expect(executor.executeBatch(batch)).resolves.not.toThrow();
    });

    it('should fire onFailed callback on final failure', async () => {
      const onFailed = vi.fn();
      executor.setOnFailed(onFailed);

      const batch = createBatch(3);
      await executor.executeBatch(batch);

      expect(onFailed).toHaveBeenCalledTimes(1);
      expect(onFailed).toHaveBeenCalledWith(batch, expect.stringContaining('failed after'));
    });

    it('should not fire onSettled callback on final failure', async () => {
      const onSettled = vi.fn();
      executor.setOnSettled(onSettled);

      const batch = createBatch(3);
      await executor.executeBatch(batch);

      expect(onSettled).not.toHaveBeenCalled();
    });

    it('should record failed batch in memory', async () => {
      const batch = createBatch(4);
      await executor.executeBatch(batch);

      const failed = executor.getFailedBatches();
      expect(failed).toHaveLength(1);
      expect(failed[0].batch).toBe(batch);
      expect(failed[0].error).toContain('failed after');
      expect(failed[0].timestamp).toBeGreaterThan(0);
    });

    it('should log operator alert on final failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const batch = createBatch(2);
      await executor.executeBatch(batch);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('OPERATOR ALERT')
      );

      consoleSpy.mockRestore();
    });

    it('should return error details on final failure', async () => {
      const batch = createBatch(2);
      const result = await executor.executeBatch(batch);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('failed after');
      expect(result.priorityFeeMultiplier).toBe(2.0);
    });

    it('should accumulate multiple failed batches', async () => {
      const batch1 = createBatch(2);
      const batch2 = createBatch(3);

      await executor.executeBatch(batch1);
      await executor.executeBatch(batch2);

      expect(executor.getFailedBatches()).toHaveLength(2);
    });
  });

  describe('callback management', () => {
    beforeEach(() => {
      executor = new SettlementExecutor({ attemptSettlement: alwaysSucceeds() });
    });

    it('should handle no onSettled callback gracefully', async () => {
      const batch = createBatch(2);
      await expect(executor.executeBatch(batch)).resolves.not.toThrow();
    });

    it('should handle no onFailed callback gracefully', async () => {
      executor = new SettlementExecutor({ attemptSettlement: alwaysFails() });
      const batch = createBatch(2);
      await expect(executor.executeBatch(batch)).resolves.not.toThrow();
    });

    it('should allow replacing callbacks', async () => {
      const first = vi.fn();
      const second = vi.fn();

      executor.setOnSettled(first);
      executor.setOnSettled(second);

      await executor.executeBatch(createBatch(1));

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });
  });
});

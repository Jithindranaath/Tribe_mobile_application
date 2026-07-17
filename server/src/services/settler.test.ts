/**
 * Unit tests for the SettlementExecutor service.
 *
 * Tests cover:
 * - Task 16.8: Retry up to 3 times with increasing priority fees [1.2×, 1.5×, 2.0×]
 * - Task 16.8: On final failure: log error + alert operators; never surface error to fan
 * - Requirements: 27.4, 27.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SettlementExecutor,
  PRIORITY_FEE_MULTIPLIERS,
  MAX_RETRIES,
  BASE_PRIORITY_FEE,
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
    ...overrides,
  };
}

function createBatch(size: number): Resolution[] {
  return Array.from({ length: size }, () => createResolution());
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
      // Always succeed
      executor = new SettlementExecutor({ delayMs: 0, successRate: 1.0 });
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
      // Always fail
      executor = new SettlementExecutor({ delayMs: 0, successRate: 0.0 });

      const batch = createBatch(2);
      const result = await executor.executeBatch(batch);

      expect(result.success).toBe(false);
      // 1 initial + 3 retries = 4 attempts total
      expect(result.attempt).toBe(MAX_RETRIES + 1);
    });

    it('should use increasing priority fee multipliers on retries', async () => {
      // Fail first 3 attempts (initial + 1.2× + 1.5×), succeed on 4th (2.0×)
      executor = new SettlementExecutor({
        delayMs: 0,
        outcomeSequence: [false, false, false, true],
      });

      const batch = createBatch(2);
      const result = await executor.executeBatch(batch);

      expect(result.success).toBe(true);
      expect(result.priorityFeeMultiplier).toBe(2.0);
    });

    it('should succeed on first retry (1.2× multiplier)', async () => {
      // Fail initial attempt, succeed on first retry (1.2×)
      executor = new SettlementExecutor({
        delayMs: 0,
        outcomeSequence: [false, true],
      });

      const batch = createBatch(2);
      const result = await executor.executeBatch(batch);

      expect(result.success).toBe(true);
      expect(result.priorityFeeMultiplier).toBe(1.2);
    });

    it('should succeed on second retry (1.5× multiplier)', async () => {
      // Fail initial + first retry, succeed on second retry (1.5×)
      executor = new SettlementExecutor({
        delayMs: 0,
        outcomeSequence: [false, false, true],
      });

      const batch = createBatch(2);
      const result = await executor.executeBatch(batch);

      expect(result.success).toBe(true);
      expect(result.priorityFeeMultiplier).toBe(1.5);
    });
  });

  describe('final failure handling (Requirement 27.5)', () => {
    beforeEach(() => {
      // Always fail
      executor = new SettlementExecutor({ delayMs: 0, successRate: 0.0 });
    });

    it('should never throw on final failure (silent to fans)', async () => {
      const batch = createBatch(5);

      // executeBatch must never throw, even on total failure
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

  describe('simulation options', () => {
    it('should respect custom delay', async () => {
      executor = new SettlementExecutor({ delayMs: 50, successRate: 1.0 });

      const start = Date.now();
      await executor.executeBatch(createBatch(1));
      const elapsed = Date.now() - start;

      // Should take at least 50ms (one attempt)
      expect(elapsed).toBeGreaterThanOrEqual(40); // small tolerance
    });

    it('should default to 90% success rate', async () => {
      // Use default options — just ensure it doesn't crash
      executor = new SettlementExecutor({ delayMs: 0 });

      const batch = createBatch(1);
      const result = await executor.executeBatch(batch);

      // With 90% success rate, most of the time this will succeed
      // But we can't assert deterministically, so just check it doesn't throw
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('callback management', () => {
    beforeEach(() => {
      executor = new SettlementExecutor({ delayMs: 0, successRate: 1.0 });
    });

    it('should handle no onSettled callback gracefully', async () => {
      // Don't set any callback
      const batch = createBatch(2);
      await expect(executor.executeBatch(batch)).resolves.not.toThrow();
    });

    it('should handle no onFailed callback gracefully', async () => {
      executor = new SettlementExecutor({ delayMs: 0, successRate: 0.0 });
      // Don't set any callback
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

/**
 * Unit tests for the SettlementQueue service.
 *
 * Tests cover:
 * - Task 15.8: Push resolution into in-memory settlement queue
 * - Task 16.1: Trigger batch when 60s elapsed OR 20 resolutions queued (whichever first)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettlementQueue } from './settlement.js';
import type { Resolution } from './resolver.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResolution(overrides?: Partial<Resolution>): Resolution {
  return {
    fanId: `fan-${Math.random().toString(36).slice(2, 8)}`,
    readId: `read-${Math.random().toString(36).slice(2, 8)}`,
    correct: true,
    standingDelta: 100,
    txLineSeq: 42,
    ...overrides,
  };
}

function makeResolutions(count: number): Resolution[] {
  return Array.from({ length: count }, (_, i) =>
    makeResolution({ fanId: `fan-${i}`, readId: `read-${i}`, txLineSeq: i })
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SettlementQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('queue() — Task 15.8', () => {
    it('should accept a single resolution', () => {
      const queue = new SettlementQueue();
      const resolution = makeResolution();

      queue.queue(resolution);

      expect(queue.getQueueSize()).toBe(1);
    });

    it('should accept an array of resolutions', () => {
      const queue = new SettlementQueue();
      const resolutions = makeResolutions(5);

      queue.queue(resolutions);

      expect(queue.getQueueSize()).toBe(5);
    });

    it('should accumulate resolutions from multiple queue() calls', () => {
      const queue = new SettlementQueue();

      queue.queue(makeResolution());
      queue.queue(makeResolution());
      queue.queue(makeResolution());

      expect(queue.getQueueSize()).toBe(3);
    });

    it('should preserve all fields of queued resolutions in batch output', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      const resolution: Resolution = {
        fanId: 'fan-abc',
        readId: 'read-xyz',
        correct: true,
        standingDelta: 240,
        txLineSeq: 77,
      };

      queue.queue(resolution);
      queue.flush();

      expect(batchReceived).toHaveLength(1);
      expect(batchReceived[0][0]).toEqual(resolution);
    });

    it('should handle empty array without error or triggering batch', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      queue.queue([]);

      expect(queue.getQueueSize()).toBe(0);
      expect(batchReceived).toHaveLength(0);
    });
  });

  describe('time-based trigger — Task 16.1 (60s)', () => {
    it('should trigger batch after 60 seconds from first queued item', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      queue.queue(makeResolution());
      expect(batchReceived).toHaveLength(0);

      vi.advanceTimersByTime(59_999);
      expect(batchReceived).toHaveLength(0);

      vi.advanceTimersByTime(1);
      expect(batchReceived).toHaveLength(1);
      expect(batchReceived[0]).toHaveLength(1);
    });

    it('should include all queued resolutions in time-triggered batch', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      queue.queue(makeResolution());
      vi.advanceTimersByTime(10_000);
      queue.queue(makeResolution());
      vi.advanceTimersByTime(20_000);
      queue.queue(makeResolution());

      // 60s from first item hasn't elapsed yet (only 30s passed)
      expect(batchReceived).toHaveLength(0);

      // Advance remaining 30s
      vi.advanceTimersByTime(30_000);
      expect(batchReceived).toHaveLength(1);
      expect(batchReceived[0]).toHaveLength(3);
    });

    it('should reset timer after batch fires and start new timer on next queue', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      queue.queue(makeResolution());
      vi.advanceTimersByTime(60_000);
      expect(batchReceived).toHaveLength(1);

      // Queue after batch fires — new 60s window starts
      queue.queue(makeResolution());
      vi.advanceTimersByTime(59_999);
      expect(batchReceived).toHaveLength(1);

      vi.advanceTimersByTime(1);
      expect(batchReceived).toHaveLength(2);
    });
  });

  describe('count-based trigger — Task 16.1 (20 items)', () => {
    it('should trigger batch immediately when 20 resolutions are queued', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      queue.queue(makeResolutions(20));

      expect(batchReceived).toHaveLength(1);
      expect(batchReceived[0]).toHaveLength(20);
    });

    it('should trigger batch when 20th item is added individually', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      // Queue 19 items one by one
      for (let i = 0; i < 19; i++) {
        queue.queue(makeResolution());
      }
      expect(batchReceived).toHaveLength(0);

      // 20th item triggers batch
      queue.queue(makeResolution());
      expect(batchReceived).toHaveLength(1);
      expect(batchReceived[0]).toHaveLength(20);
    });

    it('should trigger when array push crosses the 20-item threshold', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      queue.queue(makeResolutions(15));
      expect(batchReceived).toHaveLength(0);

      queue.queue(makeResolutions(5));
      expect(batchReceived).toHaveLength(1);
      expect(batchReceived[0]).toHaveLength(20);
    });

    it('should cancel the 60s timer when count threshold triggers batch', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      queue.queue(makeResolutions(20));
      expect(batchReceived).toHaveLength(1);

      // Advance time past 60s — should NOT trigger another batch
      vi.advanceTimersByTime(120_000);
      expect(batchReceived).toHaveLength(1);
    });
  });

  describe('whichever-first behavior — Task 16.1', () => {
    it('time wins: 60s elapsed with fewer than 20 items', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      queue.queue(makeResolutions(5));
      vi.advanceTimersByTime(60_000);

      expect(batchReceived).toHaveLength(1);
      expect(batchReceived[0]).toHaveLength(5);
    });

    it('count wins: 20 items before 60s', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      queue.queue(makeResolutions(10));
      vi.advanceTimersByTime(10_000); // only 10s elapsed

      queue.queue(makeResolutions(10));
      // Count threshold hit — batch fired before 60s
      expect(batchReceived).toHaveLength(1);
      expect(batchReceived[0]).toHaveLength(20);

      // Ensure timer doesn't fire again
      vi.advanceTimersByTime(60_000);
      expect(batchReceived).toHaveLength(1);
    });
  });

  describe('flush()', () => {
    it('should force-trigger current batch immediately', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      queue.queue(makeResolutions(3));
      queue.flush();

      expect(batchReceived).toHaveLength(1);
      expect(batchReceived[0]).toHaveLength(3);
    });

    it('should be a no-op when queue is empty', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      queue.flush();

      expect(batchReceived).toHaveLength(0);
    });

    it('should cancel the 60s timer', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      queue.queue(makeResolution());
      queue.flush();
      expect(batchReceived).toHaveLength(1);

      // Timer should be cancelled — no second trigger
      vi.advanceTimersByTime(120_000);
      expect(batchReceived).toHaveLength(1);
    });

    it('should clear the queue after flushing', () => {
      const queue = new SettlementQueue();

      queue.queue(makeResolutions(5));
      queue.flush();

      expect(queue.getQueueSize()).toBe(0);
    });
  });

  describe('reset()', () => {
    it('should clear all queued resolutions', () => {
      const queue = new SettlementQueue();

      queue.queue(makeResolutions(10));
      queue.reset();

      expect(queue.getQueueSize()).toBe(0);
    });

    it('should cancel the pending timer without triggering batch', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      queue.queue(makeResolutions(5));
      queue.reset();

      // Advance past 60s — no batch should fire
      vi.advanceTimersByTime(120_000);
      expect(batchReceived).toHaveLength(0);
    });

    it('should allow fresh queuing after reset', () => {
      const batchReceived: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => batchReceived.push(batch));

      queue.queue(makeResolutions(5));
      queue.reset();

      queue.queue(makeResolutions(3));
      vi.advanceTimersByTime(60_000);

      expect(batchReceived).toHaveLength(1);
      expect(batchReceived[0]).toHaveLength(3);
    });
  });

  describe('setOnBatchReady()', () => {
    it('should allow setting callback after construction', () => {
      const queue = new SettlementQueue();
      const batchReceived: Resolution[][] = [];

      queue.setOnBatchReady((batch) => batchReceived.push(batch));
      queue.queue(makeResolutions(20));

      expect(batchReceived).toHaveLength(1);
    });

    it('should replace existing callback', () => {
      const first: Resolution[][] = [];
      const second: Resolution[][] = [];
      const queue = new SettlementQueue((batch) => first.push(batch));

      queue.setOnBatchReady((batch) => second.push(batch));
      queue.queue(makeResolutions(20));

      expect(first).toHaveLength(0);
      expect(second).toHaveLength(1);
    });
  });
});

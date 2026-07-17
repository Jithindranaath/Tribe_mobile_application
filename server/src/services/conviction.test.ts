/**
 * Unit tests for conviction signal aggregation service.
 *
 * Tests the core computation logic (computeConvictionSignalFromReads)
 * which is a pure function that takes reads + aggregateStanding and
 * returns a weighted signal.
 *
 * Requirements: 9.3, 9.4, 9.5
 */

import { describe, it, expect } from 'vitest';
import { computeConvictionSignalFromReads } from './conviction.js';
import type { ReadsLiveRow } from '../db/schema.js';

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeRead(overrides: Partial<ReadsLiveRow> = {}): ReadsLiveRow {
  return {
    read_id: 'read-1',
    fan_id: 'fan-1',
    fixture_id: 12345,
    read_type: 'moment_read',
    predicted: 1,
    odds_at_commit: 2.5,
    committed_at: new Date().toISOString(),
    resolved: null,
    txline_seq: null,
    status: 'pending',
    standing_delta: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('computeConvictionSignalFromReads', () => {
  it('should return zero signal with no reads', () => {
    const result = computeConvictionSignalFromReads([], 1000);
    expect(result.signal).toBe(0);
    expect(result.participantCount).toBe(0);
  });

  it('should return the predicted value when one fan commits', () => {
    const reads = [makeRead({ predicted: 1, fan_id: 'fan-1' })];
    // aggregateStanding = 100 (one fan with default 100 standing)
    const result = computeConvictionSignalFromReads(reads, 100);

    expect(result.signal).toBe(1);
    expect(result.participantCount).toBe(1);
    expect(result.readId).toBe('read-1');
  });

  it('should compute average when all fans have equal standing', () => {
    // 3 fans: predictions are 1, 0, 1 → average = 2/3 ≈ 0.667
    const reads = [
      makeRead({ predicted: 1, fan_id: 'fan-1' }),
      makeRead({ predicted: 0, fan_id: 'fan-2' }),
      makeRead({ predicted: 1, fan_id: 'fan-3' }),
    ];
    // aggregateStanding = 300 (3 fans × 100 default standing)
    const result = computeConvictionSignalFromReads(reads, 300);

    expect(result.signal).toBeCloseTo(2 / 3, 5);
    expect(result.participantCount).toBe(3);
  });

  it('should produce weighted average based on standing proportions', () => {
    // Simulate a tribe where aggregate standing is 500 (mix of fans with different standing)
    // Fan A has standing 100/500 = 0.2 weight, predicted 1
    // Fan B has standing 100/500 = 0.2 weight, predicted 0
    // With default 100 standing per fan and aggregateStanding=500:
    //   weight per fan = 100/500 = 0.2
    //   weightedSum = 0.2*1 + 0.2*0 = 0.2
    //   totalWeight = 0.4
    //   signal = 0.2 / 0.4 = 0.5
    const reads = [
      makeRead({ predicted: 1, fan_id: 'fan-1' }),
      makeRead({ predicted: 0, fan_id: 'fan-2' }),
    ];
    const result = computeConvictionSignalFromReads(reads, 500);

    expect(result.signal).toBeCloseTo(0.5, 5);
    expect(result.participantCount).toBe(2);
  });

  it('should clamp signal to 1.0 maximum', () => {
    // predicted values are 0 or 1, so signal should never exceed 1.0 normally
    // But let's test the clamp with predicted = 1
    const reads = [
      makeRead({ predicted: 1, fan_id: 'fan-1' }),
      makeRead({ predicted: 1, fan_id: 'fan-2' }),
      makeRead({ predicted: 1, fan_id: 'fan-3' }),
    ];
    const result = computeConvictionSignalFromReads(reads, 300);

    expect(result.signal).toBe(1);
  });

  it('should clamp signal to 0.0 minimum', () => {
    const reads = [
      makeRead({ predicted: 0, fan_id: 'fan-1' }),
      makeRead({ predicted: 0, fan_id: 'fan-2' }),
    ];
    const result = computeConvictionSignalFromReads(reads, 200);

    expect(result.signal).toBe(0);
  });

  it('should handle zero aggregateStanding gracefully', () => {
    const reads = [makeRead({ predicted: 1, fan_id: 'fan-1' })];
    // If aggregateStanding is 0, weights become 0 → signal should be 0
    const result = computeConvictionSignalFromReads(reads, 0);

    expect(result.signal).toBe(0);
    expect(result.participantCount).toBe(1);
  });

  it('should handle fractional predicted values for probability-style reads', () => {
    // If predicted values represent probabilities (0.0 to 1.0 range)
    const reads = [
      makeRead({ predicted: 0.8, fan_id: 'fan-1' }),
      makeRead({ predicted: 0.6, fan_id: 'fan-2' }),
      makeRead({ predicted: 0.9, fan_id: 'fan-3' }),
    ];
    // All equal weight → average = (0.8 + 0.6 + 0.9) / 3 ≈ 0.767
    const result = computeConvictionSignalFromReads(reads, 300);

    expect(result.signal).toBeCloseTo(2.3 / 3, 5);
    expect(result.participantCount).toBe(3);
  });

  it('should use readId from first read in the array', () => {
    const reads = [
      makeRead({ read_id: 'prompt-xyz', fan_id: 'fan-1' }),
      makeRead({ read_id: 'prompt-xyz', fan_id: 'fan-2' }),
    ];
    const result = computeConvictionSignalFromReads(reads, 200);

    expect(result.readId).toBe('prompt-xyz');
  });
});

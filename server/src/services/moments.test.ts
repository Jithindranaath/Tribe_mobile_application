/**
 * Unit tests for the Notable Moment Classifier service.
 *
 * Tests cover:
 * - Task 19.1: classifyMoment pure function with all three notability conditions
 * - Task 19.1: createTimelineEntry database insertion
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyMoment, createTimelineEntry } from './moments.js';
import type { ReadsLiveRow } from '../db/schema.js';

// ─── Mock Supabase ───────────────────────────────────────────────────────────

vi.mock('../lib/supabase.js', () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from '../lib/supabase.js';

// ─── classifyMoment Tests ────────────────────────────────────────────────────

describe('classifyMoment', () => {
  describe('Condition A: difficulty_multiplier > 2.0 (Req 14.1)', () => {
    it('should classify as notable when odds_at_commit > 2.0', () => {
      const read = { odds_at_commit: 3.0, predicted: 0.5 };
      const result = classifyMoment(read, 0.5, 0.5);

      expect(result.isNotable).toBe(true);
      expect(result.reasons).toContain('high_difficulty');
    });

    it('should NOT classify when odds_at_commit === 2.0 (not strictly greater)', () => {
      const read = { odds_at_commit: 2.0, predicted: 0.5 };
      const result = classifyMoment(read, 0.5, 0.5);

      expect(result.reasons).not.toContain('high_difficulty');
    });

    it('should NOT classify when odds_at_commit < 2.0', () => {
      const read = { odds_at_commit: 1.5, predicted: 0.5 };
      const result = classifyMoment(read, 0.5, 0.5);

      expect(result.reasons).not.toContain('high_difficulty');
    });

    it('should use default 1.0 when odds_at_commit is null', () => {
      const read = { odds_at_commit: null, predicted: 0.5 };
      const result = classifyMoment(read, 0.5, 0.5);

      expect(result.reasons).not.toContain('high_difficulty');
    });
  });

  describe('Condition B: timingBonusPercentile >= 0.9 (Req 14.2)', () => {
    it('should classify as notable when timing percentile is in top 10%', () => {
      const read = { odds_at_commit: 1.0, predicted: 0.5 };
      const result = classifyMoment(read, 0.5, 0.95);

      expect(result.isNotable).toBe(true);
      expect(result.reasons).toContain('top_timing');
    });

    it('should classify when timing percentile is exactly 0.9', () => {
      const read = { odds_at_commit: 1.0, predicted: 0.5 };
      const result = classifyMoment(read, 0.5, 0.9);

      expect(result.isNotable).toBe(true);
      expect(result.reasons).toContain('top_timing');
    });

    it('should NOT classify when timing percentile is below 0.9', () => {
      const read = { odds_at_commit: 1.0, predicted: 0.5 };
      const result = classifyMoment(read, 0.5, 0.89);

      expect(result.reasons).not.toContain('top_timing');
    });
  });

  describe('Condition C: |predicted - conviction_signal| > 0.7 (Req 14.3)', () => {
    it('should classify as notable when fan predicted against tribe conviction', () => {
      // Fan predicted 1, tribe signal was 0.2 → |1 - 0.2| = 0.8 > 0.7
      const read = { odds_at_commit: 1.0, predicted: 1 };
      const result = classifyMoment(read, 0.2, 0.5);

      expect(result.isNotable).toBe(true);
      expect(result.reasons).toContain('against_the_grain');
    });

    it('should classify when predicted is 0 and conviction is high', () => {
      // Fan predicted 0, tribe signal was 0.8 → |0 - 0.8| = 0.8 > 0.7
      const read = { odds_at_commit: 1.0, predicted: 0 };
      const result = classifyMoment(read, 0.8, 0.5);

      expect(result.isNotable).toBe(true);
      expect(result.reasons).toContain('against_the_grain');
    });

    it('should NOT classify when difference is exactly 0.7', () => {
      // |0.9 - 0.2| = 0.7, not strictly greater
      const read = { odds_at_commit: 1.0, predicted: 0.9 };
      const result = classifyMoment(read, 0.2, 0.5);

      expect(result.reasons).not.toContain('against_the_grain');
    });

    it('should NOT classify when prediction aligns with conviction', () => {
      // Fan predicted 0.8, tribe signal was 0.75 → |0.8 - 0.75| = 0.05
      const read = { odds_at_commit: 1.0, predicted: 0.8 };
      const result = classifyMoment(read, 0.75, 0.5);

      expect(result.reasons).not.toContain('against_the_grain');
    });
  });

  describe('Combined conditions', () => {
    it('should return multiple reasons when multiple conditions are met', () => {
      // High difficulty (3.5 > 2.0) + top timing (0.95 >= 0.9) + against-the-grain (|1-0.1|=0.9 > 0.7)
      const read = { odds_at_commit: 3.5, predicted: 1 };
      const result = classifyMoment(read, 0.1, 0.95);

      expect(result.isNotable).toBe(true);
      expect(result.reasons).toContain('high_difficulty');
      expect(result.reasons).toContain('top_timing');
      expect(result.reasons).toContain('against_the_grain');
      expect(result.reasons).toHaveLength(3);
    });

    it('should return isNotable=false when no conditions are met', () => {
      const read = { odds_at_commit: 1.5, predicted: 0.5 };
      const result = classifyMoment(read, 0.5, 0.5);

      expect(result.isNotable).toBe(false);
      expect(result.reasons).toHaveLength(0);
    });

    it('should return isNotable=true if only one condition is met', () => {
      // Only condition A met
      const read = { odds_at_commit: 4.0, predicted: 0.5 };
      const result = classifyMoment(read, 0.5, 0.5);

      expect(result.isNotable).toBe(true);
      expect(result.reasons).toEqual(['high_difficulty']);
    });
  });
});

// ─── createTimelineEntry Tests ───────────────────────────────────────────────

describe('createTimelineEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockRead: ReadsLiveRow = {
    read_id: 'read-123',
    fan_id: 'fan-456',
    fixture_id: 999,
    read_type: 'moment_read',
    predicted: 1,
    odds_at_commit: 3.0,
    committed_at: '2024-06-15T14:30:00Z',
    resolved: 1,
    txline_seq: 42,
    status: 'resolved',
    standing_delta: 450,
    created_at: '2024-06-15T14:30:00Z',
  };

  it('should insert a timeline entry with correct payload', async () => {
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'timeline-abc' },
          error: null,
        }),
      }),
    });

    const mockFrom = vi.fn().mockReturnValue({
      insert: insertMock,
    });

    vi.mocked(getSupabaseClient).mockReturnValue({ from: mockFrom } as any);

    const result = await createTimelineEntry(mockRead, 999, ['high_difficulty', 'top_timing']);

    expect(result).toBe('timeline-abc');
    expect(mockFrom).toHaveBeenCalledWith('timeline');
    expect(insertMock).toHaveBeenCalledWith({
      fan_id: 'fan-456',
      moment_id: 'moment-read-123',
      fixture_id: 999,
      type: 'READ_SUCCESS',
      payload_json: {
        readId: 'read-123',
        readType: 'moment_read',
        predicted: 1,
        resolved: 1,
        correct: true,
        difficulty: 3.0,
        standingDelta: 450,
        reasons: ['high_difficulty', 'top_timing'],
      },
    });
  });

  it('should return null on database error', async () => {
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Insert failed' },
        }),
      }),
    });

    const mockFrom = vi.fn().mockReturnValue({
      insert: insertMock,
    });

    vi.mocked(getSupabaseClient).mockReturnValue({ from: mockFrom } as any);

    const result = await createTimelineEntry(mockRead, 999, ['high_difficulty']);

    expect(result).toBeNull();
  });

  it('should generate moment_id from read_id', async () => {
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'timeline-xyz' },
          error: null,
        }),
      }),
    });

    const mockFrom = vi.fn().mockReturnValue({
      insert: insertMock,
    });

    vi.mocked(getSupabaseClient).mockReturnValue({ from: mockFrom } as any);

    await createTimelineEntry(mockRead, 999, ['against_the_grain']);

    const insertArg = insertMock.mock.calls[0][0];
    expect(insertArg.moment_id).toBe('moment-read-123');
  });
});

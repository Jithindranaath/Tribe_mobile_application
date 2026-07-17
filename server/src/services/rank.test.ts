/**
 * Unit tests for the tribe rank computation service.
 *
 * Tests the core computeRanks logic, getRank/getAllRanks queries,
 * and start/stop lifecycle.
 *
 * Requirements: 13.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RankService } from './rank.js';
import type { TribeData } from './rank.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTribe(overrides: Partial<TribeData> = {}): TribeData {
  return {
    tribeId: 'tribe-1',
    macroId: 1,
    regionId: 100,
    aggregateStanding: 1000,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RankService', () => {
  let service: RankService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new RankService();
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  describe('computeRanks', () => {
    it('should assign rank 1 to the tribe with highest aggregate_standing in a macro-tribe', () => {
      service.setTribes([
        makeTribe({ tribeId: 'brazil-sp', macroId: 1, aggregateStanding: 5000 }),
        makeTribe({ tribeId: 'brazil-rj', macroId: 1, aggregateStanding: 8000 }),
        makeTribe({ tribeId: 'brazil-bh', macroId: 1, aggregateStanding: 3000 }),
      ]);

      service.computeRanks();

      expect(service.getRank('brazil-rj')).toBe(1);
      expect(service.getRank('brazil-sp')).toBe(2);
      expect(service.getRank('brazil-bh')).toBe(3);
    });

    it('should rank tribes independently per macro-tribe', () => {
      service.setTribes([
        makeTribe({ tribeId: 'brazil-sp', macroId: 1, aggregateStanding: 5000 }),
        makeTribe({ tribeId: 'brazil-rj', macroId: 1, aggregateStanding: 8000 }),
        makeTribe({ tribeId: 'germany-berlin', macroId: 2, aggregateStanding: 3000 }),
        makeTribe({ tribeId: 'germany-munich', macroId: 2, aggregateStanding: 7000 }),
      ]);

      service.computeRanks();

      // Brazil macro-tribe
      expect(service.getRank('brazil-rj')).toBe(1);
      expect(service.getRank('brazil-sp')).toBe(2);

      // Germany macro-tribe
      expect(service.getRank('germany-munich')).toBe(1);
      expect(service.getRank('germany-berlin')).toBe(2);
    });

    it('should handle a single tribe in a macro-tribe (rank 1)', () => {
      service.setTribes([
        makeTribe({ tribeId: 'argentina-bsas', macroId: 3, aggregateStanding: 4000 }),
      ]);

      service.computeRanks();

      expect(service.getRank('argentina-bsas')).toBe(1);
    });

    it('should handle empty tribes list', () => {
      service.setTribes([]);
      service.computeRanks();

      expect(service.getAllRanks()).toEqual([]);
    });

    it('should handle tribes with equal aggregate_standing (stable order)', () => {
      service.setTribes([
        makeTribe({ tribeId: 'france-paris', macroId: 4, aggregateStanding: 5000 }),
        makeTribe({ tribeId: 'france-lyon', macroId: 4, aggregateStanding: 5000 }),
      ]);

      service.computeRanks();

      const ranks = service.getAllRanks().filter((r) => r.macroId === 4);
      const rankValues = ranks.map((r) => r.rank).sort();
      // Both get distinct ranks (1, 2) even with same standing
      expect(rankValues).toEqual([1, 2]);
    });

    it('should update ranks when tribe standings change', () => {
      service.setTribes([
        makeTribe({ tribeId: 'brazil-sp', macroId: 1, aggregateStanding: 5000 }),
        makeTribe({ tribeId: 'brazil-rj', macroId: 1, aggregateStanding: 8000 }),
      ]);

      service.computeRanks();
      expect(service.getRank('brazil-rj')).toBe(1);
      expect(service.getRank('brazil-sp')).toBe(2);

      // SP overtakes RJ
      service.updateTribeStanding('brazil-sp', 10000);
      service.computeRanks();

      expect(service.getRank('brazil-sp')).toBe(1);
      expect(service.getRank('brazil-rj')).toBe(2);
    });
  });

  describe('getRank', () => {
    it('should return undefined for unknown tribe', () => {
      service.setTribes([
        makeTribe({ tribeId: 'brazil-sp', macroId: 1, aggregateStanding: 5000 }),
      ]);
      service.computeRanks();

      expect(service.getRank('unknown-tribe')).toBeUndefined();
    });
  });

  describe('getAllRanks', () => {
    it('should return all rank entries with correct fields', () => {
      service.setTribes([
        makeTribe({ tribeId: 'brazil-sp', macroId: 1, regionId: 101, aggregateStanding: 5000 }),
        makeTribe({ tribeId: 'brazil-rj', macroId: 1, regionId: 102, aggregateStanding: 8000 }),
      ]);

      service.computeRanks();

      const ranks = service.getAllRanks();
      expect(ranks).toHaveLength(2);

      const rj = ranks.find((r) => r.tribeId === 'brazil-rj');
      expect(rj).toEqual({
        tribeId: 'brazil-rj',
        macroId: 1,
        regionId: 102,
        aggregateStanding: 8000,
        rank: 1,
      });
    });
  });

  describe('start / stop lifecycle', () => {
    it('should compute ranks immediately on start', () => {
      service.setTribes([
        makeTribe({ tribeId: 'brazil-sp', macroId: 1, aggregateStanding: 5000 }),
      ]);

      service.start(60_000);

      // Should have computed immediately
      expect(service.getRank('brazil-sp')).toBe(1);
      expect(service.isRunning()).toBe(true);
    });

    it('should recompute ranks on each interval tick', () => {
      service.setTribes([
        makeTribe({ tribeId: 'brazil-sp', macroId: 1, aggregateStanding: 5000 }),
        makeTribe({ tribeId: 'brazil-rj', macroId: 1, aggregateStanding: 8000 }),
      ]);

      service.start(60_000);
      expect(service.getRank('brazil-rj')).toBe(1);

      // Simulate standing change between ticks
      service.updateTribeStanding('brazil-sp', 10000);

      // Advance timer by 60s
      vi.advanceTimersByTime(60_000);

      expect(service.getRank('brazil-sp')).toBe(1);
      expect(service.getRank('brazil-rj')).toBe(2);
    });

    it('should not start a second interval if already running', () => {
      service.setTribes([]);
      service.start(60_000);
      service.start(60_000); // second call is no-op

      expect(service.isRunning()).toBe(true);
    });

    it('should stop the interval', () => {
      service.setTribes([]);
      service.start(60_000);
      expect(service.isRunning()).toBe(true);

      service.stop();
      expect(service.isRunning()).toBe(false);
    });

    it('should handle stop when not started', () => {
      // Should not throw
      service.stop();
      expect(service.isRunning()).toBe(false);
    });
  });

  describe('updateTribeStanding', () => {
    it('should update the standing of an existing tribe', () => {
      service.setTribes([
        makeTribe({ tribeId: 'brazil-sp', macroId: 1, aggregateStanding: 5000 }),
      ]);

      service.updateTribeStanding('brazil-sp', 9999);
      service.computeRanks();

      const ranks = service.getAllRanks();
      expect(ranks[0].aggregateStanding).toBe(9999);
    });

    it('should be a no-op for unknown tribe id', () => {
      service.setTribes([
        makeTribe({ tribeId: 'brazil-sp', macroId: 1, aggregateStanding: 5000 }),
      ]);

      // Should not throw
      service.updateTribeStanding('unknown', 9999);
      service.computeRanks();

      expect(service.getAllRanks()).toHaveLength(1);
      expect(service.getAllRanks()[0].aggregateStanding).toBe(5000);
    });
  });
});

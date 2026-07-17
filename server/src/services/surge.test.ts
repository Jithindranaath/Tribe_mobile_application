/**
 * Tests for the SurgeService and buildSurgePayload.
 *
 * Covers:
 * - Task 17.1: Surge broadcast on GOAL_EVENT resolution
 * - Requirements: 12.1 (surge within 500ms), 12.5 (Standing updates broadcast)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SurgeService, buildSurgePayload } from './surge.js';
import type { Resolution } from './resolver.js';
import type { CampfireWSServer } from '../ws/server.js';
import type { SurgePayload } from '../ws/types.js';

// ─── buildSurgePayload Tests ─────────────────────────────────────────────────

describe('buildSurgePayload', () => {
  it('should return null when no resolutions have correct reads', () => {
    const resolutions: Resolution[] = [
      { fanId: 'fan-1', readId: 'read-1', correct: false, standingDelta: -5, txLineSeq: 10 },
      { fanId: 'fan-2', readId: 'read-2', correct: false, standingDelta: -5, txLineSeq: 10 },
    ];

    const result = buildSurgePayload('fixture-123', resolutions);
    expect(result).toBeNull();
  });

  it('should return null for empty resolutions array', () => {
    const result = buildSurgePayload('fixture-123', []);
    expect(result).toBeNull();
  });

  it('should build payload when at least one read is correct', () => {
    const resolutions: Resolution[] = [
      { fanId: 'fan-1', readId: 'read-1', correct: true, standingDelta: 200, txLineSeq: 42 },
      { fanId: 'fan-2', readId: 'read-2', correct: false, standingDelta: -5, txLineSeq: 42 },
    ];

    const result = buildSurgePayload('fixture-123', resolutions);

    expect(result).not.toBeNull();
    expect(result!.fixtureId).toBe('fixture-123');
    expect(result!.type).toBe('goal');
    expect(result!.message).toBe('CALLED IT');
  });

  it('should include ALL standing deltas (correct and incorrect)', () => {
    const resolutions: Resolution[] = [
      { fanId: 'fan-1', readId: 'read-1', correct: true, standingDelta: 240, txLineSeq: 42 },
      { fanId: 'fan-2', readId: 'read-2', correct: false, standingDelta: -5, txLineSeq: 42 },
      { fanId: 'fan-3', readId: 'read-3', correct: true, standingDelta: 300, txLineSeq: 42 },
    ];

    const result = buildSurgePayload('fixture-123', resolutions);

    expect(result!.standingDeltas).toHaveLength(3);
    expect(result!.standingDeltas).toEqual([
      { fanId: 'fan-1', delta: 240 },
      { fanId: 'fan-2', delta: -5 },
      { fanId: 'fan-3', delta: 300 },
    ]);
  });

  it('should build payload with single correct read', () => {
    const resolutions: Resolution[] = [
      { fanId: 'fan-1', readId: 'read-1', correct: true, standingDelta: 100, txLineSeq: 5 },
    ];

    const result = buildSurgePayload('fixture-999', resolutions);

    expect(result).toEqual({
      fixtureId: 'fixture-999',
      type: 'goal',
      message: 'CALLED IT',
      standingDeltas: [{ fanId: 'fan-1', delta: 100 }],
    });
  });
});

// ─── SurgeService Tests ──────────────────────────────────────────────────────

describe('SurgeService', () => {
  let mockWsServer: { broadcastSurge: ReturnType<typeof vi.fn> };
  let surgeService: SurgeService;
  let tribeIdResolver: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockWsServer = {
      broadcastSurge: vi.fn(),
    };
    tribeIdResolver = vi.fn().mockReturnValue('tribe-brazil-sp');
    surgeService = new SurgeService({
      wsServer: mockWsServer as unknown as CampfireWSServer,
      tribeIdResolver,
    });
  });

  describe('triggerSurge', () => {
    it('should not broadcast when resolutions array is empty', () => {
      surgeService.triggerSurge('fixture-123', []);

      expect(mockWsServer.broadcastSurge).not.toHaveBeenCalled();
    });

    it('should not broadcast when no reads are correct', () => {
      const resolutions: Resolution[] = [
        { fanId: 'fan-1', readId: 'read-1', correct: false, standingDelta: -5, txLineSeq: 10 },
      ];

      surgeService.triggerSurge('fixture-123', resolutions);

      expect(mockWsServer.broadcastSurge).not.toHaveBeenCalled();
    });

    it('should broadcast surge when at least one read is correct', () => {
      const resolutions: Resolution[] = [
        { fanId: 'fan-1', readId: 'read-1', correct: true, standingDelta: 200, txLineSeq: 42 },
        { fanId: 'fan-2', readId: 'read-2', correct: false, standingDelta: -5, txLineSeq: 42 },
      ];

      surgeService.triggerSurge('fixture-123', resolutions);

      expect(mockWsServer.broadcastSurge).toHaveBeenCalledTimes(1);
      expect(mockWsServer.broadcastSurge).toHaveBeenCalledWith(
        'tribe-brazil-sp',
        'fixture-123',
        {
          fixtureId: 'fixture-123',
          type: 'goal',
          message: 'CALLED IT',
          standingDeltas: [
            { fanId: 'fan-1', delta: 200 },
            { fanId: 'fan-2', delta: -5 },
          ],
        }
      );
    });

    it('should resolve tribeId from fixtureId', () => {
      const resolutions: Resolution[] = [
        { fanId: 'fan-1', readId: 'read-1', correct: true, standingDelta: 100, txLineSeq: 1 },
      ];

      surgeService.triggerSurge('fixture-456', resolutions);

      expect(tribeIdResolver).toHaveBeenCalledWith('fixture-456');
    });

    it('should not broadcast if tribeIdResolver returns null', () => {
      tribeIdResolver.mockReturnValue(null);

      const resolutions: Resolution[] = [
        { fanId: 'fan-1', readId: 'read-1', correct: true, standingDelta: 150, txLineSeq: 7 },
      ];

      surgeService.triggerSurge('fixture-unknown', resolutions);

      expect(mockWsServer.broadcastSurge).not.toHaveBeenCalled();
    });

    it('should include all fan deltas in broadcast payload', () => {
      const resolutions: Resolution[] = [
        { fanId: 'fan-a', readId: 'read-a', correct: true, standingDelta: 300, txLineSeq: 50 },
        { fanId: 'fan-b', readId: 'read-b', correct: true, standingDelta: 240, txLineSeq: 50 },
        { fanId: 'fan-c', readId: 'read-c', correct: false, standingDelta: -5, txLineSeq: 50 },
      ];

      surgeService.triggerSurge('fixture-789', resolutions);

      const callArgs = mockWsServer.broadcastSurge.mock.calls[0];
      const payload: SurgePayload = callArgs[2];

      expect(payload.standingDeltas).toHaveLength(3);
      expect(payload.standingDeltas[0]).toEqual({ fanId: 'fan-a', delta: 300 });
      expect(payload.standingDeltas[1]).toEqual({ fanId: 'fan-b', delta: 240 });
      expect(payload.standingDeltas[2]).toEqual({ fanId: 'fan-c', delta: -5 });
    });
  });

  describe('integration with ReadResolver onResolution callback', () => {
    it('should work as a callback for ReadResolver.onResolution', () => {
      // Simulate how the surge service is wired: resolver calls the callback
      const callback = (fixtureId: string, resolutions: Resolution[]) => {
        surgeService.triggerSurge(fixtureId, resolutions);
      };

      const resolutions: Resolution[] = [
        { fanId: 'fan-1', readId: 'read-1', correct: true, standingDelta: 100, txLineSeq: 1 },
      ];

      callback('fixture-100', resolutions);

      expect(mockWsServer.broadcastSurge).toHaveBeenCalledTimes(1);
      expect(mockWsServer.broadcastSurge).toHaveBeenCalledWith(
        'tribe-brazil-sp',
        'fixture-100',
        expect.objectContaining({
          fixtureId: 'fixture-100',
          type: 'goal',
          message: 'CALLED IT',
        })
      );
    });
  });
});

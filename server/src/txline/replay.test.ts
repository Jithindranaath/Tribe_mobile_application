import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReplayManager, type TxLINEFixture, type ReplayManagerOptions } from './replay.js';
import type { TxLINERawScoreEvent } from './normalizer.js';
import type { TxLINEActivation } from './activation.js';

// ─── Mock Helpers ────────────────────────────────────────────────────────────

function createMockActivation(): TxLINEActivation {
  return {
    getAuthHeaders: () => ({
      Authorization: 'Bearer test-jwt',
      'X-Api-Token': 'test-api-token',
    }),
  } as unknown as TxLINEActivation;
}

function createFixture(overrides: Partial<TxLINEFixture> = {}): TxLINEFixture {
  return {
    fixtureId: '12345',
    sport: 'football',
    league: 'FIFA World Cup',
    homeTeam: 'Brazil',
    awayTeam: 'Argentina',
    kickoff: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    state: 'finished',
    coverage: true,
    ...overrides,
  };
}

function createHistoricalEvent(overrides: Partial<TxLINERawScoreEvent> = {}): TxLINERawScoreEvent {
  return {
    fixtureId: '12345',
    seq: 1,
    ts: 1000,
    gameState: '1H',
    homeScore: 0,
    awayScore: 0,
    ...overrides,
  };
}

function createManager(overrides: Partial<ReplayManagerOptions> = {}): ReplayManager {
  return new ReplayManager({
    activation: createMockActivation(),
    fetchFixtures: async () => [],
    fetchHistoricalData: async () => [],
    processEvent: async () => {},
    ...overrides,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ReplayManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('checkFixtureAvailability', () => {
    it('returns true when a live covered fixture exists', async () => {
      const manager = createManager({
        fetchFixtures: async () => [
          createFixture({ state: 'live', coverage: true }),
        ],
      });

      const result = await manager.checkFixtureAvailability();
      expect(result).toBe(true);
    });

    it('returns false when no live covered fixture exists', async () => {
      const manager = createManager({
        fetchFixtures: async () => [
          createFixture({ state: 'finished', coverage: true }),
          createFixture({ state: 'live', coverage: false }),
          createFixture({ state: 'scheduled', coverage: true }),
        ],
      });

      const result = await manager.checkFixtureAvailability();
      expect(result).toBe(false);
    });

    it('returns false when fixture list is empty', async () => {
      const manager = createManager({
        fetchFixtures: async () => [],
      });

      const result = await manager.checkFixtureAvailability();
      expect(result).toBe(false);
    });

    it('returns false on fetch error (allows replay mode entry)', async () => {
      const manager = createManager({
        fetchFixtures: async () => { throw new Error('Network error'); },
      });

      const result = await manager.checkFixtureAvailability();
      expect(result).toBe(false);
    });
  });

  describe('startPolling', () => {
    it('runs an immediate check on start', async () => {
      const fetchFixtures = vi.fn().mockResolvedValue([
        createFixture({ state: 'live', coverage: true }),
      ]);

      const manager = createManager({ fetchFixtures });
      manager.startPolling(60_000);

      // Allow the immediate async call to resolve
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchFixtures).toHaveBeenCalledTimes(1);
      manager.shutdown();
    });

    it('polls at the configured interval', async () => {
      const fetchFixtures = vi.fn().mockResolvedValue([
        createFixture({ state: 'live', coverage: true }),
      ]);

      const manager = createManager({ fetchFixtures });
      manager.startPolling(60_000);

      await vi.advanceTimersByTimeAsync(0); // initial
      await vi.advanceTimersByTimeAsync(60_000); // second poll
      await vi.advanceTimersByTimeAsync(60_000); // third poll

      expect(fetchFixtures).toHaveBeenCalledTimes(3);
      manager.shutdown();
    });

    it('enters replay mode when no live fixture is detected', async () => {
      const processEvent = vi.fn();
      const historicalEvents = [
        createHistoricalEvent({ ts: 1000, seq: 1 }),
        createHistoricalEvent({ ts: 2000, seq: 2 }),
      ];

      const manager = createManager({
        fetchFixtures: async () => [createFixture({ state: 'finished' })],
        fetchHistoricalData: async () => historicalEvents,
        processEvent,
      });

      manager.startPolling(60_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(manager.isReplayActive).toBe(true);
      manager.shutdown();
    });

    it('stops polling when stopPolling is called', async () => {
      const fetchFixtures = vi.fn().mockResolvedValue([
        createFixture({ state: 'live', coverage: true }),
      ]);

      const manager = createManager({ fetchFixtures });
      manager.startPolling(60_000);

      await vi.advanceTimersByTimeAsync(0); // initial
      manager.stopPolling();
      await vi.advanceTimersByTimeAsync(120_000); // would be 2 more polls

      expect(fetchFixtures).toHaveBeenCalledTimes(1);
      manager.shutdown();
    });
  });

  describe('selectReplayFixture', () => {
    it('returns null when no fixtures available', async () => {
      const manager = createManager({
        fetchFixtures: async () => [],
      });

      const result = await manager.selectReplayFixture();
      expect(result).toBeNull();
    });

    it('filters out fixtures that are not finished', async () => {
      const manager = createManager({
        fetchFixtures: async () => [
          createFixture({ state: 'live', fixtureId: '1' }),
          createFixture({ state: 'scheduled', fixtureId: '2' }),
        ],
      });

      const result = await manager.selectReplayFixture();
      expect(result).toBeNull();
    });

    it('filters out fixtures outside the valid time window (too recent)', async () => {
      const manager = createManager({
        fetchFixtures: async () => [
          createFixture({
            state: 'finished',
            kickoff: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago (< 6h)
          }),
        ],
      });

      const result = await manager.selectReplayFixture();
      expect(result).toBeNull();
    });

    it('filters out fixtures outside the valid time window (too old)', async () => {
      const manager = createManager({
        fetchFixtures: async () => [
          createFixture({
            state: 'finished',
            kickoff: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days ago (> 14d)
          }),
        ],
      });

      const result = await manager.selectReplayFixture();
      expect(result).toBeNull();
    });

    it('selects fixtures within the valid window', async () => {
      const validFixture = createFixture({
        state: 'finished',
        fixtureId: 'valid-1',
        kickoff: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 2 days ago
      });

      const manager = createManager({
        fetchFixtures: async () => [validFixture],
      });

      const result = await manager.selectReplayFixture();
      expect(result).not.toBeNull();
      expect(result!.fixtureId).toBe('valid-1');
    });

    it('prioritizes World Cup fixtures', async () => {
      const worldCupFixture = createFixture({
        state: 'finished',
        fixtureId: 'wc-1',
        league: 'FIFA World Cup',
        homeTeam: 'Japan',
        awayTeam: 'Australia',
        kickoff: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      });

      const regularFixture = createFixture({
        state: 'finished',
        fixtureId: 'regular-1',
        league: 'Premier League',
        homeTeam: 'Crystal Palace',
        awayTeam: 'Burnley',
        kickoff: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      });

      const manager = createManager({
        fetchFixtures: async () => [regularFixture, worldCupFixture],
      });

      const result = await manager.selectReplayFixture();
      expect(result!.fixtureId).toBe('wc-1');
    });

    it('prioritizes high-profile teams within same league', async () => {
      const highProfileFixture = createFixture({
        state: 'finished',
        fixtureId: 'high-1',
        league: 'Premier League',
        homeTeam: 'Brazil',
        awayTeam: 'Argentina',
        kickoff: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      });

      const lowProfileFixture = createFixture({
        state: 'finished',
        fixtureId: 'low-1',
        league: 'Premier League',
        homeTeam: 'Togo',
        awayTeam: 'Panama',
        kickoff: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      });

      const manager = createManager({
        fetchFixtures: async () => [lowProfileFixture, highProfileFixture],
      });

      const result = await manager.selectReplayFixture();
      expect(result!.fixtureId).toBe('high-1');
    });

    it('returns null on fetch error', async () => {
      const manager = createManager({
        fetchFixtures: async () => { throw new Error('API error'); },
      });

      const result = await manager.selectReplayFixture();
      expect(result).toBeNull();
    });
  });

  describe('enterReplayMode', () => {
    it('sets isReplayActive to true', async () => {
      const manager = createManager({
        fetchFixtures: async () => [
          createFixture({
            state: 'finished',
            kickoff: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          }),
        ],
        fetchHistoricalData: async () => [createHistoricalEvent()],
      });

      await manager.enterReplayMode();
      expect(manager.isReplayActive).toBe(true);
    });

    it('sets currentFixtureId to the selected fixture', async () => {
      const manager = createManager({
        fetchFixtures: async () => [
          createFixture({
            state: 'finished',
            fixtureId: 'fixture-abc',
            kickoff: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          }),
        ],
        fetchHistoricalData: async () => [createHistoricalEvent()],
      });

      await manager.enterReplayMode();
      expect(manager.currentFixtureId).toBe('fixture-abc');
    });

    it('does not re-enter if already in replay mode', async () => {
      const fetchHistoricalData = vi.fn().mockResolvedValue([createHistoricalEvent()]);

      const manager = createManager({
        fetchFixtures: async () => [
          createFixture({
            state: 'finished',
            kickoff: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          }),
        ],
        fetchHistoricalData,
      });

      await manager.enterReplayMode();
      await manager.enterReplayMode(); // second call should be no-op

      expect(fetchHistoricalData).toHaveBeenCalledTimes(1);
    });

    it('does not enter replay if no suitable fixture found', async () => {
      const manager = createManager({
        fetchFixtures: async () => [],
      });

      await manager.enterReplayMode();
      expect(manager.isReplayActive).toBe(false);
      expect(manager.currentFixtureId).toBeNull();
    });
  });

  describe('streamHistoricalEvents', () => {
    it('processes events in timestamp order with correct timing', async () => {
      const processedEvents: TxLINERawScoreEvent[] = [];
      const processEvent = vi.fn(async (event: TxLINERawScoreEvent) => {
        processedEvents.push(event);
      });

      const events = [
        createHistoricalEvent({ ts: 1000, seq: 1, gameState: '1H' }),
        createHistoricalEvent({ ts: 3000, seq: 2, gameState: '1H' }),
        createHistoricalEvent({ ts: 6000, seq: 3, gameState: 'HT' }),
      ];

      const manager = createManager({
        fetchFixtures: async () => [
          createFixture({
            state: 'finished',
            kickoff: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          }),
        ],
        fetchHistoricalData: async () => events,
        processEvent,
      });

      // Manually set replay active state for streamHistoricalEvents
      (manager as any)._isReplayActive = true;
      await manager.streamHistoricalEvents('12345');

      // First event fires immediately (delay = 0)
      await vi.advanceTimersByTimeAsync(0);
      expect(processedEvents.length).toBe(1);
      expect(processedEvents[0].seq).toBe(1);

      // Second event fires at ts=3000-1000=2000ms
      await vi.advanceTimersByTimeAsync(2000);
      expect(processedEvents.length).toBe(2);
      expect(processedEvents[1].seq).toBe(2);

      // Third event fires at ts=6000-1000=5000ms (already advanced 2000, need 3000 more)
      await vi.advanceTimersByTimeAsync(3000);
      expect(processedEvents.length).toBe(3);
      expect(processedEvents[2].seq).toBe(3);

      manager.shutdown();
    });

    it('respects playback speed multiplier', async () => {
      const processedEvents: TxLINERawScoreEvent[] = [];
      const processEvent = vi.fn(async (event: TxLINERawScoreEvent) => {
        processedEvents.push(event);
      });

      const events = [
        createHistoricalEvent({ ts: 0, seq: 1 }),
        createHistoricalEvent({ ts: 10_000, seq: 2 }), // 10s real-time gap
      ];

      const manager = createManager({
        fetchHistoricalData: async () => events,
        processEvent,
        playbackSpeed: 10, // 10x speed → 10s becomes 1s
      });

      (manager as any)._isReplayActive = true;
      await manager.streamHistoricalEvents('12345');

      await vi.advanceTimersByTimeAsync(0); // first event
      expect(processedEvents.length).toBe(1);

      // At 10x speed, 10s gap becomes 1s
      await vi.advanceTimersByTimeAsync(999);
      expect(processedEvents.length).toBe(1); // not yet

      await vi.advanceTimersByTimeAsync(1);
      expect(processedEvents.length).toBe(2); // now fires

      manager.shutdown();
    });

    it('exits replay mode when empty events array is received', async () => {
      const manager = createManager({
        fetchHistoricalData: async () => [],
      });

      (manager as any)._isReplayActive = true;
      (manager as any)._currentFixtureId = '12345';

      await manager.streamHistoricalEvents('12345');

      expect(manager.isReplayActive).toBe(false);
      expect(manager.currentFixtureId).toBeNull();
    });

    it('does not process events after exitReplayMode is called', async () => {
      const processEvent = vi.fn();
      const events = [
        createHistoricalEvent({ ts: 0, seq: 1 }),
        createHistoricalEvent({ ts: 5000, seq: 2 }),
        createHistoricalEvent({ ts: 10000, seq: 3 }),
      ];

      const manager = createManager({
        fetchHistoricalData: async () => events,
        processEvent,
      });

      (manager as any)._isReplayActive = true;
      await manager.streamHistoricalEvents('12345');

      await vi.advanceTimersByTimeAsync(0); // first event
      expect(processEvent).toHaveBeenCalledTimes(1);

      // Exit replay mode before remaining events fire
      manager.exitReplayMode();

      await vi.advanceTimersByTimeAsync(15000);
      expect(processEvent).toHaveBeenCalledTimes(1); // no more events processed
    });
  });

  describe('exitReplayMode', () => {
    it('clears isReplayActive and currentFixtureId', async () => {
      const manager = createManager({
        fetchFixtures: async () => [
          createFixture({
            state: 'finished',
            kickoff: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          }),
        ],
        fetchHistoricalData: async () => [createHistoricalEvent()],
      });

      await manager.enterReplayMode();
      expect(manager.isReplayActive).toBe(true);

      manager.exitReplayMode();
      expect(manager.isReplayActive).toBe(false);
      expect(manager.currentFixtureId).toBeNull();
    });

    it('cancels all pending event timeouts', async () => {
      const processEvent = vi.fn();
      const events = [
        createHistoricalEvent({ ts: 0, seq: 1 }),
        createHistoricalEvent({ ts: 60_000, seq: 2 }),
        createHistoricalEvent({ ts: 120_000, seq: 3 }),
      ];

      const manager = createManager({
        fetchHistoricalData: async () => events,
        processEvent,
      });

      (manager as any)._isReplayActive = true;
      await manager.streamHistoricalEvents('12345');

      await vi.advanceTimersByTimeAsync(0); // first event fires
      manager.exitReplayMode();

      // Advance past when events would have fired
      await vi.advanceTimersByTimeAsync(200_000);
      expect(processEvent).toHaveBeenCalledTimes(1); // only first event
    });
  });

  describe('polling integration', () => {
    it('exits replay mode when a live fixture appears', async () => {
      let fixtureState = 'finished';
      const fetchFixtures = vi.fn(async () => [
        createFixture({
          state: fixtureState,
          kickoff: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        }),
      ]);

      const manager = createManager({
        fetchFixtures,
        fetchHistoricalData: async () => [
          createHistoricalEvent({ ts: 0 }),
          createHistoricalEvent({ ts: 600_000 }), // 10 min later
        ],
        processEvent: async () => {},
      });

      manager.startPolling(60_000);
      await vi.advanceTimersByTimeAsync(0); // enters replay

      expect(manager.isReplayActive).toBe(true);

      // Now simulate a live fixture appearing
      fixtureState = 'live';
      await vi.advanceTimersByTimeAsync(60_000); // next poll

      expect(manager.isReplayActive).toBe(false);
      manager.shutdown();
    });
  });

  describe('shutdown', () => {
    it('stops polling and exits replay mode', async () => {
      const fetchFixtures = vi.fn().mockResolvedValue([
        createFixture({
          state: 'finished',
          kickoff: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        }),
      ]);

      const manager = createManager({
        fetchFixtures,
        fetchHistoricalData: async () => [createHistoricalEvent()],
      });

      manager.startPolling(60_000);
      await vi.advanceTimersByTimeAsync(0); // enters replay

      manager.shutdown();

      expect(manager.isReplayActive).toBe(false);

      // Verify polling stopped
      await vi.advanceTimersByTimeAsync(120_000);
      // initial (1) + no additional calls after shutdown
      const callsAfterShutdown = fetchFixtures.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchFixtures.mock.calls.length).toBe(callsAfterShutdown);
    });
  });
});

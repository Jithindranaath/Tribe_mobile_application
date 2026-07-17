/**
 * Unit tests for TxLINE scores stream event normalizer.
 * Validates: Requirements 2.5, 2.6, 2.7
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  normalizeScoreEvent,
  resetScoresCache,
  setPreviousScore,
  type TxLINERawScoreEvent,
} from './normalizer.js';
import {
  eventBus,
  GOAL_EVENT,
  RED_CARD_EVENT,
  STATE_CHANGE_EVENT,
} from '../events/event-bus.js';
import type { GoalEvent, RedCardEvent, StateChangeEvent } from '../events/event-bus.js';

// ─── Mock Supabase ───────────────────────────────────────────────────────────

const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

vi.mock('../lib/supabase.js', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

// ─── Test Setup ──────────────────────────────────────────────────────────────

describe('normalizeScoreEvent', () => {
  beforeEach(() => {
    resetScoresCache();
    mockInsert.mockClear();
    mockFrom.mockClear();
    eventBus.removeAllListeners();
  });

  afterEach(() => {
    eventBus.removeAllListeners();
  });

  // ─── Goal Detection ────────────────────────────────────────────────────────

  describe('Goal event normalization (Requirement 2.5)', () => {
    it('emits GOAL_EVENT when incidents array contains a goal', async () => {
      const events: GoalEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => events.push(e));

      const raw: TxLINERawScoreEvent = {
        fixtureId: '12345',
        seq: 10,
        ts: 1700000000,
        gameState: '1H',
        homeScore: 1,
        awayScore: 0,
        incidents: [{ type: 'goal', team: 'home', player: 'Neymar' }],
      };

      await normalizeScoreEvent(raw);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        fixtureId: '12345',
        seq: 10,
        timestamp: 1700000000,
        gameState: '1H',
        team: 'home',
        player: 'Neymar',
      });
    });

    it('emits GOAL_EVENT when homeScore increases (score-change detection)', async () => {
      setPreviousScore('12345', 0, 0);

      const events: GoalEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => events.push(e));

      const raw: TxLINERawScoreEvent = {
        fixtureId: '12345',
        seq: 11,
        ts: 1700000100,
        gameState: '1H',
        homeScore: 1,
        awayScore: 0,
      };

      await normalizeScoreEvent(raw);

      expect(events).toHaveLength(1);
      expect(events[0].team).toBe('home');
    });

    it('emits GOAL_EVENT when awayScore increases', async () => {
      setPreviousScore('12345', 0, 0);

      const events: GoalEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => events.push(e));

      const raw: TxLINERawScoreEvent = {
        fixtureId: '12345',
        seq: 12,
        ts: 1700000200,
        gameState: '1H',
        homeScore: 0,
        awayScore: 1,
      };

      await normalizeScoreEvent(raw);

      expect(events).toHaveLength(1);
      expect(events[0].team).toBe('away');
    });

    it('does NOT emit GOAL_EVENT when scores are unchanged', async () => {
      setPreviousScore('12345', 1, 0);

      const events: GoalEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => events.push(e));

      const raw: TxLINERawScoreEvent = {
        fixtureId: '12345',
        seq: 13,
        ts: 1700000300,
        gameState: '1H',
        homeScore: 1,
        awayScore: 0,
      };

      await normalizeScoreEvent(raw);

      expect(events).toHaveLength(0);
    });

    it('prefers incidents array over score-change detection for player info', async () => {
      setPreviousScore('12345', 0, 0);

      const events: GoalEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => events.push(e));

      const raw: TxLINERawScoreEvent = {
        fixtureId: '12345',
        seq: 14,
        ts: 1700000400,
        gameState: '1H',
        homeScore: 1,
        awayScore: 0,
        incidents: [{ type: 'goal', team: 'home', player: 'Mbappé' }],
      };

      await normalizeScoreEvent(raw);

      expect(events).toHaveLength(1);
      expect(events[0].player).toBe('Mbappé');
    });
  });

  // ─── Red Card Detection ────────────────────────────────────────────────────

  describe('Red card event normalization (Requirement 2.6)', () => {
    it('emits RED_CARD_EVENT when incidents contain a red card', async () => {
      const events: RedCardEvent[] = [];
      eventBus.on(RED_CARD_EVENT, (e) => events.push(e));

      const raw: TxLINERawScoreEvent = {
        fixtureId: '12345',
        seq: 20,
        ts: 1700001000,
        gameState: '2H',
        homeScore: 1,
        awayScore: 1,
        incidents: [{ type: 'red_card', team: 'away', player: 'Ramos' }],
      };

      await normalizeScoreEvent(raw);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        fixtureId: '12345',
        seq: 20,
        timestamp: 1700001000,
        gameState: '2H',
        player: 'Ramos',
      });
    });

    it('emits multiple RED_CARD_EVENTs when multiple red cards in one event', async () => {
      const events: RedCardEvent[] = [];
      eventBus.on(RED_CARD_EVENT, (e) => events.push(e));

      const raw: TxLINERawScoreEvent = {
        fixtureId: '12345',
        seq: 21,
        ts: 1700001100,
        gameState: '2H',
        homeScore: 1,
        awayScore: 1,
        incidents: [
          { type: 'red_card', team: 'home', player: 'PlayerA' },
          { type: 'red_card', team: 'away', player: 'PlayerB' },
        ],
      };

      await normalizeScoreEvent(raw);

      expect(events).toHaveLength(2);
    });

    it('does NOT emit RED_CARD_EVENT for yellow cards', async () => {
      const events: RedCardEvent[] = [];
      eventBus.on(RED_CARD_EVENT, (e) => events.push(e));

      const raw: TxLINERawScoreEvent = {
        fixtureId: '12345',
        seq: 22,
        ts: 1700001200,
        gameState: '1H',
        homeScore: 0,
        awayScore: 0,
        incidents: [{ type: 'yellow_card', team: 'home', player: 'Casemiro' }],
      };

      await normalizeScoreEvent(raw);

      expect(events).toHaveLength(0);
    });
  });

  // ─── State Change Detection ────────────────────────────────────────────────

  describe('State change event normalization (Requirement 2.7)', () => {
    it('emits STATE_CHANGE_EVENT for HT gameState', async () => {
      const events: StateChangeEvent[] = [];
      eventBus.on(STATE_CHANGE_EVENT, (e) => events.push(e));

      const raw: TxLINERawScoreEvent = {
        fixtureId: '12345',
        seq: 30,
        ts: 1700002000,
        gameState: 'HT',
        homeScore: 1,
        awayScore: 0,
      };

      await normalizeScoreEvent(raw);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        fixtureId: '12345',
        seq: 30,
        timestamp: 1700002000,
        newGameState: 'HT',
      });
    });

    it.each(['2H', 'FT', 'ET', 'PEN'])('emits STATE_CHANGE_EVENT for %s gameState', async (state) => {
      const events: StateChangeEvent[] = [];
      eventBus.on(STATE_CHANGE_EVENT, (e) => events.push(e));

      const raw: TxLINERawScoreEvent = {
        fixtureId: '99999',
        seq: 31,
        ts: 1700003000,
        gameState: state,
        homeScore: 0,
        awayScore: 0,
      };

      await normalizeScoreEvent(raw);

      expect(events).toHaveLength(1);
      expect(events[0].newGameState).toBe(state);
    });

    it('does NOT emit STATE_CHANGE_EVENT for 1H gameState', async () => {
      const events: StateChangeEvent[] = [];
      eventBus.on(STATE_CHANGE_EVENT, (e) => events.push(e));

      const raw: TxLINERawScoreEvent = {
        fixtureId: '12345',
        seq: 32,
        ts: 1700004000,
        gameState: '1H',
        homeScore: 0,
        awayScore: 0,
      };

      await normalizeScoreEvent(raw);

      expect(events).toHaveLength(0);
    });
  });

  // ─── Persistence ───────────────────────────────────────────────────────────

  describe('match_events persistence (Requirement 4.6, 25.3)', () => {
    it('stores every raw event in match_events table', async () => {
      const raw: TxLINERawScoreEvent = {
        fixtureId: '12345',
        seq: 40,
        ts: 1700005000,
        gameState: '1H',
        homeScore: 0,
        awayScore: 0,
      };

      await normalizeScoreEvent(raw);

      expect(mockFrom).toHaveBeenCalledWith('match_events');
      expect(mockInsert).toHaveBeenCalledWith({
        fixture_id: 12345,
        seq: 40,
        ts: 1700005000,
        game_state: '1H',
        event_json: raw,
      });
    });

    it('does not throw when Supabase insert fails', async () => {
      mockInsert.mockResolvedValueOnce({ error: { message: 'DB error' } });

      const raw: TxLINERawScoreEvent = {
        fixtureId: '12345',
        seq: 41,
        ts: 1700005100,
        gameState: '1H',
        homeScore: 0,
        awayScore: 0,
      };

      // Should not throw
      await expect(normalizeScoreEvent(raw)).resolves.not.toThrow();
    });
  });

  // ─── Combined events ───────────────────────────────────────────────────────

  describe('combined event handling', () => {
    it('emits both GOAL_EVENT and STATE_CHANGE_EVENT when goal occurs at state change', async () => {
      setPreviousScore('12345', 1, 1);

      const goalEvents: GoalEvent[] = [];
      const stateEvents: StateChangeEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => goalEvents.push(e));
      eventBus.on(STATE_CHANGE_EVENT, (e) => stateEvents.push(e));

      const raw: TxLINERawScoreEvent = {
        fixtureId: '12345',
        seq: 50,
        ts: 1700006000,
        gameState: 'ET',
        homeScore: 2,
        awayScore: 1,
        incidents: [{ type: 'goal', team: 'home', player: 'Messi' }],
      };

      await normalizeScoreEvent(raw);

      expect(goalEvents).toHaveLength(1);
      expect(stateEvents).toHaveLength(1);
      expect(goalEvents[0].player).toBe('Messi');
      expect(stateEvents[0].newGameState).toBe('ET');
    });

    it('emits goal and red card from same event', async () => {
      const goalEvents: GoalEvent[] = [];
      const redCardEvents: RedCardEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => goalEvents.push(e));
      eventBus.on(RED_CARD_EVENT, (e) => redCardEvents.push(e));

      const raw: TxLINERawScoreEvent = {
        fixtureId: '12345',
        seq: 51,
        ts: 1700006100,
        gameState: '2H',
        homeScore: 1,
        awayScore: 0,
        incidents: [
          { type: 'goal', team: 'home', player: 'Ronaldo' },
          { type: 'red_card', team: 'away', player: 'Pepe' },
        ],
      };

      await normalizeScoreEvent(raw);

      expect(goalEvents).toHaveLength(1);
      expect(redCardEvents).toHaveLength(1);
    });
  });
});

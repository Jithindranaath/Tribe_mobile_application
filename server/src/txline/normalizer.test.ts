/**
 * Unit tests for TxLINE scores stream event normalizer.
 * Validates: Requirements 2.5, 2.6, 2.7
 *
 * Fixtures use the real TxLINE payload shape (PascalCase, per-action, Stats-keyed —
 * captured from the live SSE stream and the historical endpoint), not the flat
 * camelCase shape the normalizer was originally (incorrectly) written against.
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

// ─── Fixture Builder ─────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<TxLINERawScoreEvent> = {}): TxLINERawScoreEvent {
  return {
    FixtureId: 12345,
    Seq: 10,
    Ts: 1700000000,
    StatusId: 2, // H1
    Participant1IsHome: true,
    Participant1Id: 1,
    Participant2Id: 2,
    Stats: { '1': 0, '2': 0, '5': 0, '6': 0 },
    Action: 'goal',
    ...overrides,
  };
}

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

  // ─── Heartbeat Guard ─────────────────────────────────────────────────────

  describe('heartbeat handling', () => {
    it('is a no-op for heartbeat messages with no FixtureId', async () => {
      const goalEvents: GoalEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => goalEvents.push(e));

      await normalizeScoreEvent({ Ts: 1700000000 });

      expect(goalEvents).toHaveLength(0);
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  // ─── Goal Detection ────────────────────────────────────────────────────────

  describe('Goal event normalization (Requirement 2.5)', () => {
    it('does NOT emit GOAL_EVENT on the first event seen for a fixture (no baseline yet)', async () => {
      const events: GoalEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => events.push(e));

      await normalizeScoreEvent(makeEvent({ Stats: { '1': 1, '2': 0, '5': 0, '6': 0 } }));

      expect(events).toHaveLength(0);
    });

    it('emits GOAL_EVENT for home when Participant1 (home) total goals increases', async () => {
      setPreviousScore('12345', 0, 0);

      const events: GoalEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => events.push(e));

      await normalizeScoreEvent(
        makeEvent({
          Seq: 11,
          Ts: 1700000100,
          Participant1IsHome: true,
          Stats: { '1': 1, '2': 0, '5': 0, '6': 0 },
        }),
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        fixtureId: '12345',
        seq: 11,
        timestamp: 1700000100,
        gameState: 'H1',
        team: 'home',
      });
    });

    it('emits GOAL_EVENT for away when Participant2 (away) total goals increases', async () => {
      setPreviousScore('12345', 0, 0);

      const events: GoalEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => events.push(e));

      await normalizeScoreEvent(
        makeEvent({
          Seq: 12,
          Ts: 1700000200,
          Participant1IsHome: true,
          Stats: { '1': 0, '2': 1, '5': 0, '6': 0 },
        }),
      );

      expect(events).toHaveLength(1);
      expect(events[0].team).toBe('away');
    });

    it('flips home/away mapping when Participant1IsHome is false', async () => {
      setPreviousScore('12345', 0, 0);

      const events: GoalEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => events.push(e));

      await normalizeScoreEvent(
        makeEvent({
          Participant1IsHome: false,
          Stats: { '1': 1, '2': 0, '5': 0, '6': 0 },
        }),
      );

      expect(events).toHaveLength(1);
      expect(events[0].team).toBe('away'); // Participant1 scored but is the away side
    });

    it('does NOT emit GOAL_EVENT when goal stats are unchanged', async () => {
      setPreviousScore('12345', 1, 0);

      const events: GoalEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => events.push(e));

      await normalizeScoreEvent(makeEvent({ Stats: { '1': 1, '2': 0, '5': 0, '6': 0 } }));

      expect(events).toHaveLength(0);
    });

    it('emits one GOAL_EVENT per goal when the stat jumps by more than 1', async () => {
      setPreviousScore('12345', 0, 0);

      const events: GoalEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => events.push(e));

      await normalizeScoreEvent(makeEvent({ Stats: { '1': 2, '2': 0, '5': 0, '6': 0 } }));

      expect(events).toHaveLength(2);
    });

    it('ignores a goals-count bump on a non-goal Action (VAR review noise) — real match seq 1060 case', async () => {
      setPreviousScore('12345', 0, 0);

      const events: GoalEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => events.push(e));

      // A VAR-review event carries a transient/stale goals bump — must not count.
      await normalizeScoreEvent(
        makeEvent({ Action: 'var_end', Stats: { '1': 1, '2': 0, '5': 0, '6': 0 } }),
      );
      expect(events).toHaveLength(0);

      // A later non-goal event "corrects" it back down — still not a goal.
      await normalizeScoreEvent(
        makeEvent({ Action: 'action_amend', Stats: { '1': 0, '2': 0, '5': 0, '6': 0 } }),
      );
      expect(events).toHaveLength(0);

      // The real confirmed goal, tagged Action: 'goal' — this is the one real delta.
      await normalizeScoreEvent(
        makeEvent({ Action: 'goal', Stats: { '1': 1, '2': 0, '5': 0, '6': 0 } }),
      );
      expect(events).toHaveLength(1);
      expect(events[0].team).toBe('home');

      // A further VAR event after the real goal, with an inflated stale count — ignored.
      await normalizeScoreEvent(
        makeEvent({ Action: 'var_end', Stats: { '1': 2, '2': 0, '5': 0, '6': 0 } }),
      );
      expect(events).toHaveLength(1);
    });
  });

  // ─── Red Card Detection ────────────────────────────────────────────────────

  describe('Red card event normalization (Requirement 2.6)', () => {
    it('does NOT emit RED_CARD_EVENT on the first event seen for a fixture', async () => {
      const events: RedCardEvent[] = [];
      eventBus.on(RED_CARD_EVENT, (e) => events.push(e));

      await normalizeScoreEvent(makeEvent({ Stats: { '1': 0, '2': 0, '5': 1, '6': 0 } }));

      expect(events).toHaveLength(0);
    });

    it('emits RED_CARD_EVENT when P1 total red cards increases', async () => {
      setPreviousScore('12345', 0, 0, 0, 0);

      const events: RedCardEvent[] = [];
      eventBus.on(RED_CARD_EVENT, (e) => events.push(e));

      await normalizeScoreEvent(
        makeEvent({ Seq: 20, Ts: 1700001000, StatusId: 4, Stats: { '1': 0, '2': 0, '5': 1, '6': 0 } }),
      );

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        fixtureId: '12345',
        seq: 20,
        timestamp: 1700001000,
        gameState: 'H2',
      });
    });

    it('emits RED_CARD_EVENT when P2 total red cards increases', async () => {
      setPreviousScore('12345', 0, 0, 0, 0);

      const events: RedCardEvent[] = [];
      eventBus.on(RED_CARD_EVENT, (e) => events.push(e));

      await normalizeScoreEvent(makeEvent({ Stats: { '1': 0, '2': 0, '5': 0, '6': 1 } }));

      expect(events).toHaveLength(1);
    });

    it('emits two RED_CARD_EVENTs when both sides get a card in the same event', async () => {
      setPreviousScore('12345', 0, 0, 0, 0);

      const events: RedCardEvent[] = [];
      eventBus.on(RED_CARD_EVENT, (e) => events.push(e));

      await normalizeScoreEvent(makeEvent({ Stats: { '1': 0, '2': 0, '5': 1, '6': 1 } }));

      expect(events).toHaveLength(2);
    });

    it('does NOT emit RED_CARD_EVENT when red card stats are unchanged', async () => {
      setPreviousScore('12345', 0, 0, 1, 0);

      const events: RedCardEvent[] = [];
      eventBus.on(RED_CARD_EVENT, (e) => events.push(e));

      await normalizeScoreEvent(makeEvent({ Stats: { '1': 0, '2': 0, '5': 1, '6': 0 } }));

      expect(events).toHaveLength(0);
    });
  });

  // ─── State Change Detection ────────────────────────────────────────────────

  describe('State change event normalization (Requirement 2.7)', () => {
    it('does NOT emit STATE_CHANGE_EVENT on the first event seen for a fixture', async () => {
      const events: StateChangeEvent[] = [];
      eventBus.on(STATE_CHANGE_EVENT, (e) => events.push(e));

      await normalizeScoreEvent(makeEvent({ StatusId: 3 })); // HT

      expect(events).toHaveLength(0);
    });

    it.each([
      [3, 'HT'],
      [4, 'H2'],
      [5, 'F'],
      [7, 'ET1'],
      [9, 'ET2'],
      [12, 'PE'],
      [100, 'FINISHED'],
    ])('emits STATE_CHANGE_EVENT on transition into statusId %i (%s)', async (statusId, phase) => {
      setPreviousScore('99999', 0, 0, 0, 0, 2); // baseline: H1

      const events: StateChangeEvent[] = [];
      eventBus.on(STATE_CHANGE_EVENT, (e) => events.push(e));

      await normalizeScoreEvent(
        makeEvent({ FixtureId: 99999, Seq: 31, Ts: 1700003000, StatusId: statusId }),
      );

      expect(events).toHaveLength(1);
      expect(events[0].newGameState).toBe(phase);
    });

    it('does NOT emit STATE_CHANGE_EVENT for a transition into H1 (not a meaningful phase)', async () => {
      setPreviousScore('12345', 0, 0, 0, 0, 1); // baseline: NS

      const events: StateChangeEvent[] = [];
      eventBus.on(STATE_CHANGE_EVENT, (e) => events.push(e));

      await normalizeScoreEvent(makeEvent({ StatusId: 2 })); // H1

      expect(events).toHaveLength(0);
    });

    it('does NOT emit STATE_CHANGE_EVENT repeatedly while StatusId stays the same', async () => {
      setPreviousScore('12345', 0, 0, 0, 0, 4); // baseline already H2

      const events: StateChangeEvent[] = [];
      eventBus.on(STATE_CHANGE_EVENT, (e) => events.push(e));

      // Real live traffic re-sends many action events per second within the same phase.
      await normalizeScoreEvent(makeEvent({ Seq: 40, StatusId: 4 }));
      await normalizeScoreEvent(makeEvent({ Seq: 41, StatusId: 4 }));
      await normalizeScoreEvent(makeEvent({ Seq: 42, StatusId: 4 }));

      expect(events).toHaveLength(0);
    });
  });

  // ─── Persistence ───────────────────────────────────────────────────────────

  describe('match_events persistence (Requirement 4.6, 25.3)', () => {
    it('stores every non-heartbeat raw event in match_events table', async () => {
      const raw = makeEvent({ Seq: 40, Ts: 1700005000, StatusId: 2 });

      await normalizeScoreEvent(raw);

      expect(mockFrom).toHaveBeenCalledWith('match_events');
      expect(mockInsert).toHaveBeenCalledWith({
        fixture_id: 12345,
        seq: 40,
        ts: 1700005000,
        game_state: 'H1',
        event_json: raw,
      });
    });

    it('does not throw when Supabase insert fails', async () => {
      mockInsert.mockResolvedValueOnce({ error: { message: 'DB error' } });

      await expect(normalizeScoreEvent(makeEvent({ Seq: 41 }))).resolves.not.toThrow();
    });
  });

  // ─── Combined events ───────────────────────────────────────────────────────

  describe('combined event handling', () => {
    it('emits both GOAL_EVENT and STATE_CHANGE_EVENT when a goal coincides with a phase transition', async () => {
      setPreviousScore('12345', 1, 1, 0, 0, 4); // baseline: H2, 1-1

      const goalEvents: GoalEvent[] = [];
      const stateEvents: StateChangeEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => goalEvents.push(e));
      eventBus.on(STATE_CHANGE_EVENT, (e) => stateEvents.push(e));

      await normalizeScoreEvent(
        makeEvent({ Seq: 50, Ts: 1700006000, StatusId: 7, Stats: { '1': 2, '2': 1, '5': 0, '6': 0 } }),
      );

      expect(goalEvents).toHaveLength(1);
      expect(stateEvents).toHaveLength(1);
      expect(stateEvents[0].newGameState).toBe('ET1');
    });

    it('emits goal and red card from the same event', async () => {
      setPreviousScore('12345', 0, 0, 0, 0);

      const goalEvents: GoalEvent[] = [];
      const redCardEvents: RedCardEvent[] = [];
      eventBus.on(GOAL_EVENT, (e) => goalEvents.push(e));
      eventBus.on(RED_CARD_EVENT, (e) => redCardEvents.push(e));

      await normalizeScoreEvent(
        makeEvent({ Seq: 51, Ts: 1700006100, Stats: { '1': 1, '2': 0, '5': 0, '6': 1 } }),
      );

      expect(goalEvents).toHaveLength(1);
      expect(redCardEvents).toHaveLength(1);
    });
  });
});

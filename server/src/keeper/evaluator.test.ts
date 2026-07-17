import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeeperEvaluator } from './evaluator.js';
import { KeeperDecision } from './types.js';
import {
  EventBus,
  GOAL_EVENT,
  RED_CARD_EVENT,
  STATE_CHANGE_EVENT,
  ODDS_SHIFT_EVENT,
  GoalEvent,
  RedCardEvent,
  StateChangeEvent,
  OddsShiftEvent,
} from '../events/event-bus.js';

describe('KeeperEvaluator', () => {
  let bus: EventBus;
  let evaluator: KeeperEvaluator;
  let decisions: KeeperDecision[];

  beforeEach(() => {
    bus = new EventBus();
    evaluator = new KeeperEvaluator(bus);
    decisions = [];
    evaluator.setOnDecision((d) => decisions.push(d));
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function makeGoalEvent(fixtureId = 'fix-1'): GoalEvent {
    return { fixtureId, seq: 1, timestamp: Date.now(), gameState: '1H', team: 'home' };
  }

  function makeRedCardEvent(fixtureId = 'fix-1'): RedCardEvent {
    return { fixtureId, seq: 2, timestamp: Date.now(), gameState: '2H', player: 'Pepe' };
  }

  function makeStateChangeEvent(fixtureId = 'fix-1', newGameState = 'HT'): StateChangeEvent {
    return { fixtureId, seq: 3, timestamp: Date.now(), newGameState };
  }

  function makeOddsShiftEvent(fixtureId = 'fix-1'): OddsShiftEvent {
    return {
      fixtureId,
      timestamp: Date.now(),
      market: 'match_winner',
      oldPrice: 2.0,
      newPrice: 1.5,
      percentChange: -25,
    };
  }

  // ─── start/stop lifecycle ────────────────────────────────────────────────────

  describe('start/stop', () => {
    it('should subscribe to all events on start', () => {
      evaluator.start();
      expect(bus.listenerCount(GOAL_EVENT)).toBe(1);
      expect(bus.listenerCount(RED_CARD_EVENT)).toBe(1);
      expect(bus.listenerCount(STATE_CHANGE_EVENT)).toBe(1);
      expect(bus.listenerCount(ODDS_SHIFT_EVENT)).toBe(1);
    });

    it('should unsubscribe from all events on stop', () => {
      evaluator.start();
      evaluator.stop();
      expect(bus.listenerCount(GOAL_EVENT)).toBe(0);
      expect(bus.listenerCount(RED_CARD_EVENT)).toBe(0);
      expect(bus.listenerCount(STATE_CHANGE_EVENT)).toBe(0);
      expect(bus.listenerCount(ODDS_SHIFT_EVENT)).toBe(0);
    });

    it('should receive events through the bus after start', () => {
      evaluator.start();
      bus.emit(GOAL_EVENT, makeGoalEvent());
      expect(decisions).toHaveLength(1);
      expect(decisions[0].action).toBe('read_prompt');
    });

    it('should not receive events after stop', () => {
      evaluator.start();
      evaluator.stop();
      bus.emit(GOAL_EVENT, makeGoalEvent());
      expect(decisions).toHaveLength(0);
    });
  });

  // ─── GOAL_EVENT evaluation ───────────────────────────────────────────────────

  describe('GOAL_EVENT', () => {
    it('should return read_prompt for goals when under limit', () => {
      const decision = evaluator.evaluateEvent(GOAL_EVENT, makeGoalEvent());
      expect(decision.action).toBe('read_prompt');
      expect(decision.reason).toBe('goal_read_prompt');
    });

    it('should return inject when read limit is reached', () => {
      // Exhaust read prompt limit by emitting through the bus
      evaluator.start();
      for (let i = 0; i < 5; i++) {
        bus.emit(GOAL_EVENT, makeGoalEvent());
      }
      // Next goal should inject
      bus.emit(GOAL_EVENT, makeGoalEvent());
      expect(decisions[5].action).toBe('inject');
      expect(decisions[5].reason).toBe('goal_inject_read_limit_reached');
    });

    it('should return silent when both limits are reached', () => {
      evaluator.start();
      // 5 goals as read_prompts
      for (let i = 0; i < 5; i++) {
        bus.emit(GOAL_EVENT, makeGoalEvent());
      }
      // 10 red cards as injects to exhaust inject limit
      for (let i = 0; i < 10; i++) {
        bus.emit(RED_CARD_EVENT, makeRedCardEvent());
      }
      // Now a goal with both limits hit → should get inject from goals (since goal tries inject after read limit)
      // But inject limit is also at 10 now → silent
      bus.emit(GOAL_EVENT, makeGoalEvent());
      const lastDecision = decisions[decisions.length - 1];
      expect(lastDecision.action).toBe('silent');
      expect(lastDecision.reason).toBe('goal_all_limits_reached');
    });
  });

  // ─── RED_CARD_EVENT evaluation ───────────────────────────────────────────────

  describe('RED_CARD_EVENT', () => {
    it('should return inject for red cards', () => {
      const decision = evaluator.evaluateEvent(RED_CARD_EVENT, makeRedCardEvent());
      expect(decision.action).toBe('inject');
      expect(decision.reason).toBe('red_card_inject');
    });

    it('should return silent when inject limit is reached', () => {
      evaluator.start();
      // 10 red cards to exhaust inject limit
      for (let i = 0; i < 10; i++) {
        bus.emit(RED_CARD_EVENT, makeRedCardEvent());
      }
      bus.emit(RED_CARD_EVENT, makeRedCardEvent());
      const lastDecision = decisions[decisions.length - 1];
      expect(lastDecision.action).toBe('silent');
      expect(lastDecision.reason).toBe('red_card_inject_limit_reached');
    });
  });

  // ─── STATE_CHANGE_EVENT evaluation ───────────────────────────────────────────

  describe('STATE_CHANGE_EVENT', () => {
    it('should set isPenaltyActive and return silent for PEN state', () => {
      const decision = evaluator.evaluateEvent(STATE_CHANGE_EVENT, makeStateChangeEvent('fix-1', 'PEN'));
      expect(decision.action).toBe('silent');
      expect(decision.reason).toBe('penalty_started');

      const state = evaluator.getFixtureState('fix-1');
      expect(state?.isPenaltyActive).toBe(true);
    });

    it('should return inject for HT state change', () => {
      const decision = evaluator.evaluateEvent(STATE_CHANGE_EVENT, makeStateChangeEvent('fix-1', 'HT'));
      expect(decision.action).toBe('inject');
      expect(decision.reason).toBe('state_change_ht');
    });

    it('should return inject for FT state change', () => {
      const decision = evaluator.evaluateEvent(STATE_CHANGE_EVENT, makeStateChangeEvent('fix-1', 'FT'));
      expect(decision.action).toBe('inject');
      expect(decision.reason).toBe('state_change_ft');
    });

    it('should return inject for ET state change', () => {
      const decision = evaluator.evaluateEvent(STATE_CHANGE_EVENT, makeStateChangeEvent('fix-1', 'ET'));
      expect(decision.action).toBe('inject');
      expect(decision.reason).toBe('state_change_et');
    });

    it('should return inject for AET state change', () => {
      const decision = evaluator.evaluateEvent(STATE_CHANGE_EVENT, makeStateChangeEvent('fix-1', 'AET'));
      expect(decision.action).toBe('inject');
      expect(decision.reason).toBe('state_change_aet');
    });

    it('should return silent for non-interesting state changes (2H)', () => {
      const decision = evaluator.evaluateEvent(STATE_CHANGE_EVENT, makeStateChangeEvent('fix-1', '2H'));
      expect(decision.action).toBe('silent');
      expect(decision.reason).toBe('state_change_not_interesting');
    });

    it('should deactivate penalty when a non-PEN state is received', () => {
      // First set penalty active
      evaluator.evaluateEvent(STATE_CHANGE_EVENT, makeStateChangeEvent('fix-1', 'PEN'));
      const stateBefore = evaluator.getFixtureState('fix-1');
      expect(stateBefore?.isPenaltyActive).toBe(true);

      // Then receive a non-PEN state
      evaluator.evaluateEvent(STATE_CHANGE_EVENT, makeStateChangeEvent('fix-1', '2H'));
      const stateAfter = evaluator.getFixtureState('fix-1');
      expect(stateAfter?.isPenaltyActive).toBe(false);
    });
  });

  // ─── ODDS_SHIFT_EVENT evaluation ─────────────────────────────────────────────

  describe('ODDS_SHIFT_EVENT', () => {
    it('should return read_prompt for odds shifts when under limit', () => {
      const decision = evaluator.evaluateEvent(ODDS_SHIFT_EVENT, makeOddsShiftEvent());
      expect(decision.action).toBe('read_prompt');
      expect(decision.reason).toBe('odds_shift_read_prompt');
    });

    it('should return silent when read limit is reached', () => {
      evaluator.start();
      // Exhaust read prompts (5 goals as read_prompts)
      for (let i = 0; i < 5; i++) {
        bus.emit(GOAL_EVENT, makeGoalEvent());
      }
      // Now odds shift should be silent
      bus.emit(ODDS_SHIFT_EVENT, makeOddsShiftEvent());
      const lastDecision = decisions[decisions.length - 1];
      expect(lastDecision.action).toBe('silent');
      expect(lastDecision.reason).toBe('odds_shift_read_limit_reached');
    });
  });

  // ─── Penalty silence enforcement ────────────────────────────────────────────

  describe('penalty silence', () => {
    it('should force silence on all events during penalty', () => {
      // Activate penalty
      evaluator.evaluateEvent(STATE_CHANGE_EVENT, makeStateChangeEvent('fix-1', 'PEN'));

      // Now all events for this fixture should be silent
      evaluator.start();
      bus.emit(GOAL_EVENT, makeGoalEvent());
      bus.emit(RED_CARD_EVENT, makeRedCardEvent());
      bus.emit(ODDS_SHIFT_EVENT, makeOddsShiftEvent());

      expect(decisions).toHaveLength(3);
      decisions.forEach((d) => {
        expect(d.action).toBe('silent');
        expect(d.reason).toBe('penalty_active');
      });
    });

    it('should not affect other fixtures during penalty', () => {
      // Activate penalty for fix-1
      evaluator.evaluateEvent(STATE_CHANGE_EVENT, makeStateChangeEvent('fix-1', 'PEN'));

      // fix-2 should still operate normally
      const decision = evaluator.evaluateEvent(GOAL_EVENT, makeGoalEvent('fix-2'));
      expect(decision.action).toBe('read_prompt');
    });
  });

  // ─── Per-fixture state tracking ──────────────────────────────────────────────

  describe('per-fixture state', () => {
    it('should track reads_surfaced per fixture independently', () => {
      evaluator.start();
      // 3 reads for fix-1
      for (let i = 0; i < 3; i++) {
        bus.emit(GOAL_EVENT, makeGoalEvent('fix-1'));
      }
      // 2 reads for fix-2
      for (let i = 0; i < 2; i++) {
        bus.emit(GOAL_EVENT, makeGoalEvent('fix-2'));
      }

      expect(evaluator.getFixtureState('fix-1')?.readsSurfaced).toBe(3);
      expect(evaluator.getFixtureState('fix-2')?.readsSurfaced).toBe(2);
    });

    it('should track injects_sent per fixture independently', () => {
      evaluator.start();
      bus.emit(RED_CARD_EVENT, makeRedCardEvent('fix-1'));
      bus.emit(RED_CARD_EVENT, makeRedCardEvent('fix-1'));
      bus.emit(RED_CARD_EVENT, makeRedCardEvent('fix-2'));

      expect(evaluator.getFixtureState('fix-1')?.injectsSent).toBe(2);
      expect(evaluator.getFixtureState('fix-2')?.injectsSent).toBe(1);
    });

    it('should update lastInjectTime on inject decisions', () => {
      evaluator.start();
      const before = Date.now();
      bus.emit(RED_CARD_EVENT, makeRedCardEvent());
      const after = Date.now();

      const state = evaluator.getFixtureState('fix-1');
      expect(state?.lastInjectTime).toBeGreaterThanOrEqual(before);
      expect(state?.lastInjectTime).toBeLessThanOrEqual(after);
    });
  });

  // ─── resetFixture ────────────────────────────────────────────────────────────

  describe('resetFixture', () => {
    it('should clear all state for a fixture', () => {
      evaluator.start();
      bus.emit(GOAL_EVENT, makeGoalEvent('fix-1'));
      bus.emit(RED_CARD_EVENT, makeRedCardEvent('fix-1'));

      expect(evaluator.getFixtureState('fix-1')?.readsSurfaced).toBe(1);
      expect(evaluator.getFixtureState('fix-1')?.injectsSent).toBe(1);

      evaluator.resetFixture('fix-1');
      expect(evaluator.getFixtureState('fix-1')).toBeUndefined();
    });

    it('should not affect other fixtures', () => {
      evaluator.start();
      bus.emit(GOAL_EVENT, makeGoalEvent('fix-1'));
      bus.emit(GOAL_EVENT, makeGoalEvent('fix-2'));

      evaluator.resetFixture('fix-1');
      expect(evaluator.getFixtureState('fix-1')).toBeUndefined();
      expect(evaluator.getFixtureState('fix-2')?.readsSurfaced).toBe(1);
    });
  });

  // ─── Max 5 Read prompts enforcement ──────────────────────────────────────────

  describe('max 5 Read prompts per match', () => {
    it('should allow exactly 5 read prompts then stop', () => {
      evaluator.start();
      for (let i = 0; i < 7; i++) {
        bus.emit(ODDS_SHIFT_EVENT, makeOddsShiftEvent());
      }

      const readPrompts = decisions.filter((d) => d.action === 'read_prompt');
      const silents = decisions.filter((d) => d.action === 'silent');
      expect(readPrompts).toHaveLength(5);
      expect(silents).toHaveLength(2);
    });
  });

  // ─── onDecision callback ─────────────────────────────────────────────────────

  describe('onDecision callback', () => {
    it('should call onDecision with the decision when bus emits events', () => {
      evaluator.start();
      bus.emit(GOAL_EVENT, makeGoalEvent());

      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        action: 'read_prompt',
        fixtureId: 'fix-1',
        eventType: GOAL_EVENT,
      });
    });

    it('should not throw if onDecision is not set', () => {
      const evaluator2 = new KeeperEvaluator(bus);
      evaluator2.start();
      expect(() => bus.emit(GOAL_EVENT, makeGoalEvent())).not.toThrow();
      evaluator2.stop();
    });
  });
});

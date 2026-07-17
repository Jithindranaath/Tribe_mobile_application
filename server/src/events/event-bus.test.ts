import { describe, it, expect, beforeEach } from 'vitest';
import {
  EventBus,
  eventBus,
  GOAL_EVENT,
  RED_CARD_EVENT,
  STATE_CHANGE_EVENT,
  ODDS_SHIFT_EVENT,
  GoalEvent,
  RedCardEvent,
  StateChangeEvent,
  OddsShiftEvent,
} from './event-bus.js';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('emit and on', () => {
    it('should deliver GOAL_EVENT to subscriber', () => {
      const received: GoalEvent[] = [];
      const event: GoalEvent = {
        fixtureId: 'fix-1',
        seq: 1,
        timestamp: Date.now(),
        gameState: '1H',
        team: 'home',
        player: 'Messi',
      };

      bus.on(GOAL_EVENT, (e) => received.push(e));
      bus.emit(GOAL_EVENT, event);

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(event);
    });

    it('should deliver RED_CARD_EVENT to subscriber', () => {
      const received: RedCardEvent[] = [];
      const event: RedCardEvent = {
        fixtureId: 'fix-2',
        seq: 5,
        timestamp: Date.now(),
        gameState: '2H',
        player: 'Pepe',
      };

      bus.on(RED_CARD_EVENT, (e) => received.push(e));
      bus.emit(RED_CARD_EVENT, event);

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(event);
    });

    it('should deliver STATE_CHANGE_EVENT to subscriber', () => {
      const received: StateChangeEvent[] = [];
      const event: StateChangeEvent = {
        fixtureId: 'fix-3',
        seq: 10,
        timestamp: Date.now(),
        newGameState: 'HT',
      };

      bus.on(STATE_CHANGE_EVENT, (e) => received.push(e));
      bus.emit(STATE_CHANGE_EVENT, event);

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(event);
    });

    it('should deliver ODDS_SHIFT_EVENT to subscriber', () => {
      const received: OddsShiftEvent[] = [];
      const event: OddsShiftEvent = {
        fixtureId: 'fix-4',
        timestamp: Date.now(),
        market: 'match_winner',
        oldPrice: 2.1,
        newPrice: 1.6,
        percentChange: -23.8,
      };

      bus.on(ODDS_SHIFT_EVENT, (e) => received.push(e));
      bus.emit(ODDS_SHIFT_EVENT, event);

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(event);
    });

    it('should deliver events to multiple subscribers', () => {
      const received1: GoalEvent[] = [];
      const received2: GoalEvent[] = [];
      const event: GoalEvent = {
        fixtureId: 'fix-5',
        seq: 2,
        timestamp: Date.now(),
        gameState: '2H',
        team: 'away',
      };

      bus.on(GOAL_EVENT, (e) => received1.push(e));
      bus.on(GOAL_EVENT, (e) => received2.push(e));
      bus.emit(GOAL_EVENT, event);

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    it('should not deliver events to unrelated subscribers', () => {
      const goalReceived: GoalEvent[] = [];
      const redCardReceived: RedCardEvent[] = [];

      bus.on(GOAL_EVENT, (e) => goalReceived.push(e));
      bus.on(RED_CARD_EVENT, (e) => redCardReceived.push(e));

      bus.emit(GOAL_EVENT, {
        fixtureId: 'fix-6',
        seq: 1,
        timestamp: Date.now(),
        gameState: '1H',
        team: 'home',
      });

      expect(goalReceived).toHaveLength(1);
      expect(redCardReceived).toHaveLength(0);
    });
  });

  describe('off', () => {
    it('should unsubscribe a handler', () => {
      const received: GoalEvent[] = [];
      const handler = (e: GoalEvent) => received.push(e);
      const event: GoalEvent = {
        fixtureId: 'fix-7',
        seq: 1,
        timestamp: Date.now(),
        gameState: '1H',
        team: 'home',
      };

      bus.on(GOAL_EVENT, handler);
      bus.emit(GOAL_EVENT, event);
      expect(received).toHaveLength(1);

      bus.off(GOAL_EVENT, handler);
      bus.emit(GOAL_EVENT, event);
      expect(received).toHaveLength(1); // no new event
    });
  });

  describe('once', () => {
    it('should fire handler only once', () => {
      const received: StateChangeEvent[] = [];
      const event: StateChangeEvent = {
        fixtureId: 'fix-8',
        seq: 3,
        timestamp: Date.now(),
        newGameState: 'FT',
      };

      bus.once(STATE_CHANGE_EVENT, (e) => received.push(e));
      bus.emit(STATE_CHANGE_EVENT, event);
      bus.emit(STATE_CHANGE_EVENT, event);

      expect(received).toHaveLength(1);
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all listeners for a specific event type', () => {
      const received: GoalEvent[] = [];
      bus.on(GOAL_EVENT, (e) => received.push(e));
      bus.on(GOAL_EVENT, (e) => received.push(e));

      bus.removeAllListeners(GOAL_EVENT);
      bus.emit(GOAL_EVENT, {
        fixtureId: 'fix-9',
        seq: 1,
        timestamp: Date.now(),
        gameState: '1H',
        team: 'home',
      });

      expect(received).toHaveLength(0);
    });

    it('should remove all listeners when called without arguments', () => {
      const goalReceived: GoalEvent[] = [];
      const oddsReceived: OddsShiftEvent[] = [];

      bus.on(GOAL_EVENT, (e) => goalReceived.push(e));
      bus.on(ODDS_SHIFT_EVENT, (e) => oddsReceived.push(e));

      bus.removeAllListeners();

      bus.emit(GOAL_EVENT, {
        fixtureId: 'fix-10',
        seq: 1,
        timestamp: Date.now(),
        gameState: '1H',
        team: 'home',
      });
      bus.emit(ODDS_SHIFT_EVENT, {
        fixtureId: 'fix-10',
        timestamp: Date.now(),
        market: 'match_winner',
        oldPrice: 2.0,
        newPrice: 3.0,
        percentChange: 50,
      });

      expect(goalReceived).toHaveLength(0);
      expect(oddsReceived).toHaveLength(0);
    });
  });

  describe('listenerCount', () => {
    it('should report correct listener count', () => {
      expect(bus.listenerCount(GOAL_EVENT)).toBe(0);

      const h1 = () => {};
      const h2 = () => {};
      bus.on(GOAL_EVENT, h1);
      bus.on(GOAL_EVENT, h2);

      expect(bus.listenerCount(GOAL_EVENT)).toBe(2);

      bus.off(GOAL_EVENT, h1);
      expect(bus.listenerCount(GOAL_EVENT)).toBe(1);
    });
  });

  describe('singleton export', () => {
    it('should export a singleton instance', () => {
      expect(eventBus).toBeInstanceOf(EventBus);
    });
  });
});

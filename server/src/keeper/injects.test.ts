import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeeperInjectService, TEMPLATES, TribeIdResolver } from './injects.js';
import { KeeperEvaluator } from './evaluator.js';
import { KeeperDecision } from './types.js';
import { CampfireWSServer } from '../ws/server.js';
import { KeeperInjectPayload } from '../ws/types.js';
import {
  EventBus,
  GOAL_EVENT,
  RED_CARD_EVENT,
  STATE_CHANGE_EVENT,
  ODDS_SHIFT_EVENT,
} from '../events/event-bus.js';

describe('KeeperInjectService', () => {
  let bus: EventBus;
  let evaluator: KeeperEvaluator;
  let wsServer: CampfireWSServer;
  let service: KeeperInjectService;
  let broadcastCalls: Array<{ tribeId: string; fixtureId: string; payload: KeeperInjectPayload }>;
  let tribeResolver: TribeIdResolver;

  beforeEach(() => {
    bus = new EventBus();
    evaluator = new KeeperEvaluator(bus);
    wsServer = new CampfireWSServer();
    broadcastCalls = [];

    // Mock broadcastKeeperInject
    wsServer.broadcastKeeperInject = vi.fn(
      (tribeId: string, fixtureId: string, payload: KeeperInjectPayload) => {
        broadcastCalls.push({ tribeId, fixtureId, payload });
      }
    );

    // Default tribe resolver returns one tribe
    tribeResolver = (_fixtureId: string) => ['tribe-brazil-hyd'];

    service = new KeeperInjectService(evaluator, wsServer, tribeResolver);
    evaluator.start();
  });

  // ─── Task 22.1: GOAL_EVENT inject ───────────────────────────────────────────

  describe('GOAL_EVENT inject', () => {
    it('should broadcast a goal inject message on GOAL_EVENT when read limit is reached', () => {
      // Exhaust read prompt limit (5 goals)
      for (let i = 0; i < 5; i++) {
        bus.emit(GOAL_EVENT, {
          fixtureId: 'fix-1',
          seq: i,
          timestamp: Date.now(),
          gameState: '1H',
          team: 'home',
        });
      }

      // Clear previous broadcasts (read_prompts don't trigger injects)
      broadcastCalls = [];

      // 6th goal should trigger an inject (read limit reached)
      bus.emit(GOAL_EVENT, {
        fixtureId: 'fix-1',
        seq: 6,
        timestamp: Date.now(),
        gameState: '2H',
        team: 'away',
      });

      expect(broadcastCalls).toHaveLength(1);
      expect(broadcastCalls[0].tribeId).toBe('tribe-brazil-hyd');
      expect(broadcastCalls[0].fixtureId).toBe('fix-1');
      expect(TEMPLATES.GOAL).toContain(broadcastCalls[0].payload.message);
      expect(broadcastCalls[0].payload.emotion).toBe('celebration');
    });

    it('should use celebration emotion for goal injects', () => {
      // Exhaust read limit
      for (let i = 0; i < 5; i++) {
        bus.emit(GOAL_EVENT, {
          fixtureId: 'fix-1',
          seq: i,
          timestamp: Date.now(),
          gameState: '1H',
          team: 'home',
        });
      }
      broadcastCalls = [];

      bus.emit(GOAL_EVENT, {
        fixtureId: 'fix-1',
        seq: 6,
        timestamp: Date.now(),
        gameState: '2H',
        team: 'home',
      });

      expect(broadcastCalls[0].payload.emotion).toBe('celebration');
    });

    it('should enforce max 10 injects per match', () => {
      // Exhaust read limit first
      for (let i = 0; i < 5; i++) {
        bus.emit(GOAL_EVENT, {
          fixtureId: 'fix-1',
          seq: i,
          timestamp: Date.now(),
          gameState: '1H',
          team: 'home',
        });
      }
      broadcastCalls = [];

      // Send 12 more events that produce inject decisions
      // Red cards always produce injects
      for (let i = 0; i < 12; i++) {
        bus.emit(RED_CARD_EVENT, {
          fixtureId: 'fix-1',
          seq: 10 + i,
          timestamp: Date.now(),
          gameState: '2H',
          player: `Player${i}`,
        });
      }

      // Only 10 should actually broadcast (the evaluator enforces max 10 inject decisions)
      expect(broadcastCalls.length).toBeLessThanOrEqual(10);
    });

    it('should broadcast to all tribes returned by resolver', () => {
      tribeResolver = () => ['tribe-a', 'tribe-b', 'tribe-c'];
      service = new KeeperInjectService(evaluator, wsServer, tribeResolver);

      // Need to re-attach the decision callback since new service overrides it
      // Actually the constructor sets it, so we need to re-start evaluator for the new service
      // The evaluator's setOnDecision only stores one callback, so the last service wins
      evaluator.start();

      // Directly call handleDecision to test broadcast to multiple tribes
      const decision: KeeperDecision = {
        action: 'inject',
        fixtureId: 'fix-1',
        eventType: GOAL_EVENT,
        reason: 'goal_inject_read_limit_reached',
      };

      service.handleDecision(decision);

      expect(broadcastCalls).toHaveLength(3);
      expect(broadcastCalls[0].tribeId).toBe('tribe-a');
      expect(broadcastCalls[1].tribeId).toBe('tribe-b');
      expect(broadcastCalls[2].tribeId).toBe('tribe-c');
    });
  });

  // ─── Task 22.2: RED_CARD_EVENT inject ──────────────────────────────────────

  describe('RED_CARD_EVENT inject', () => {
    it('should broadcast a red card inject on RED_CARD_EVENT', () => {
      bus.emit(RED_CARD_EVENT, {
        fixtureId: 'fix-1',
        seq: 1,
        timestamp: Date.now(),
        gameState: '2H',
        player: 'Pepe',
      });

      expect(broadcastCalls).toHaveLength(1);
      expect(TEMPLATES.RED_CARD).toContain(broadcastCalls[0].payload.message);
    });

    it('should use tension emotion for red card injects', () => {
      bus.emit(RED_CARD_EVENT, {
        fixtureId: 'fix-1',
        seq: 1,
        timestamp: Date.now(),
        gameState: '2H',
        player: 'Pepe',
      });

      expect(broadcastCalls[0].payload.emotion).toBe('tension');
    });

    it('should select from RED_CARD templates', () => {
      // Run multiple times to verify template selection
      for (let i = 0; i < 5; i++) {
        broadcastCalls = [];
        const decision: KeeperDecision = {
          action: 'inject',
          fixtureId: `fix-${i}`,
          eventType: RED_CARD_EVENT,
          reason: 'red_card_inject',
        };
        service.handleDecision(decision);
        expect(TEMPLATES.RED_CARD).toContain(broadcastCalls[0].payload.message);
      }
    });
  });

  // ─── Task 22.3: ODDS_SHIFT_EVENT inject ────────────────────────────────────

  describe('ODDS_SHIFT_EVENT inject (magnitude > 20%)', () => {
    it('should broadcast an odds shift inject when magnitude > 20%', () => {
      service.injectForOddsShift('fix-1', -25);

      expect(broadcastCalls).toHaveLength(1);
      expect(TEMPLATES.ODDS_SHIFT).toContain(broadcastCalls[0].payload.message);
    });

    it('should NOT inject when magnitude <= 20%', () => {
      service.injectForOddsShift('fix-1', 15);
      service.injectForOddsShift('fix-1', -20);
      service.injectForOddsShift('fix-1', 20);

      expect(broadcastCalls).toHaveLength(0);
    });

    it('should inject when magnitude is exactly above 20% threshold', () => {
      service.injectForOddsShift('fix-1', 21);
      expect(broadcastCalls).toHaveLength(1);

      service.injectForOddsShift('fix-2', -21);
      expect(broadcastCalls).toHaveLength(2);
    });

    it('should use tension emotion for odds shift injects', () => {
      service.injectForOddsShift('fix-1', 30);
      expect(broadcastCalls[0].payload.emotion).toBe('tension');
    });

    it('should respect max 10 injects per match for odds shift', () => {
      // Fill up inject count to the max
      for (let i = 0; i < 10; i++) {
        service.injectForOddsShift('fix-1', 25);
      }
      expect(broadcastCalls).toHaveLength(10);

      // 11th should not broadcast
      service.injectForOddsShift('fix-1', 30);
      expect(broadcastCalls).toHaveLength(10);
    });
  });

  // ─── STATE_CHANGE injects ──────────────────────────────────────────────────

  describe('STATE_CHANGE injects', () => {
    it('should broadcast HT inject with neutral emotion', () => {
      bus.emit(STATE_CHANGE_EVENT, {
        fixtureId: 'fix-1',
        seq: 1,
        timestamp: Date.now(),
        newGameState: 'HT',
      });

      expect(broadcastCalls).toHaveLength(1);
      expect(broadcastCalls[0].payload.message).toBe('Half-time. Breathe.');
      expect(broadcastCalls[0].payload.emotion).toBe('neutral');
    });

    it('should broadcast FT inject', () => {
      bus.emit(STATE_CHANGE_EVENT, {
        fixtureId: 'fix-1',
        seq: 1,
        timestamp: Date.now(),
        newGameState: 'FT',
      });

      expect(broadcastCalls).toHaveLength(1);
      expect(broadcastCalls[0].payload.message).toBe('Full-time.');
    });

    it('should broadcast ET inject', () => {
      bus.emit(STATE_CHANGE_EVENT, {
        fixtureId: 'fix-1',
        seq: 1,
        timestamp: Date.now(),
        newGameState: 'ET',
      });

      expect(broadcastCalls).toHaveLength(1);
      expect(broadcastCalls[0].payload.message).toBe('Extra time. Stay close.');
    });
  });

  // ─── Template selection ────────────────────────────────────────────────────

  describe('selectTemplate', () => {
    it('should return a GOAL template for GOAL_EVENT', () => {
      const msg = service.selectTemplate(GOAL_EVENT, 'goal_inject_read_limit_reached');
      expect(TEMPLATES.GOAL).toContain(msg);
    });

    it('should return a RED_CARD template for RED_CARD_EVENT', () => {
      const msg = service.selectTemplate(RED_CARD_EVENT, 'red_card_inject');
      expect(TEMPLATES.RED_CARD).toContain(msg);
    });

    it('should return an ODDS_SHIFT template for ODDS_SHIFT_EVENT', () => {
      const msg = service.selectTemplate(ODDS_SHIFT_EVENT, 'odds_shift_inject');
      expect(TEMPLATES.ODDS_SHIFT).toContain(msg);
    });

    it('should return a STATE_CHANGE template for state_change_ht reason', () => {
      const msg = service.selectTemplate(STATE_CHANGE_EVENT, 'state_change_ht');
      expect(msg).toBe('Half-time. Breathe.');
    });

    it('should return null for unknown event type', () => {
      const msg = service.selectTemplate('UNKNOWN_EVENT', 'whatever');
      expect(msg).toBeNull();
    });

    it('should return null for unrecognized state change', () => {
      const msg = service.selectTemplate(STATE_CHANGE_EVENT, 'state_change_2h');
      // '2H' is not in STATE_CHANGE_TEMPLATES
      expect(msg).toBeNull();
    });
  });

  // ─── Fixture isolation ─────────────────────────────────────────────────────

  describe('fixture isolation', () => {
    it('should track inject counts per fixture independently', () => {
      service.injectForOddsShift('fix-1', 25);
      service.injectForOddsShift('fix-2', 25);

      expect(service.getInjectCount('fix-1')).toBe(1);
      expect(service.getInjectCount('fix-2')).toBe(1);
    });

    it('should reset inject count for a specific fixture', () => {
      service.injectForOddsShift('fix-1', 25);
      service.injectForOddsShift('fix-1', 25);
      expect(service.getInjectCount('fix-1')).toBe(2);

      service.resetFixture('fix-1');
      expect(service.getInjectCount('fix-1')).toBe(0);
    });
  });

  // ─── Decision filtering ────────────────────────────────────────────────────

  describe('decision filtering', () => {
    it('should ignore read_prompt decisions', () => {
      const decision: KeeperDecision = {
        action: 'read_prompt',
        fixtureId: 'fix-1',
        eventType: GOAL_EVENT,
        reason: 'goal_read_prompt',
      };

      service.handleDecision(decision);
      expect(broadcastCalls).toHaveLength(0);
    });

    it('should ignore silent decisions', () => {
      const decision: KeeperDecision = {
        action: 'silent',
        fixtureId: 'fix-1',
        eventType: GOAL_EVENT,
        reason: 'penalty_active',
      };

      service.handleDecision(decision);
      expect(broadcastCalls).toHaveLength(0);
    });
  });
});

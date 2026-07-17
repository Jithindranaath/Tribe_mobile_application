import { KeeperEvaluator } from './evaluator.js';
import { KeeperDecision } from './types.js';
import { CampfireWSServer } from '../ws/server.js';
import { KeeperInjectPayload } from '../ws/types.js';
import {
  GOAL_EVENT,
  RED_CARD_EVENT,
  STATE_CHANGE_EVENT,
  ODDS_SHIFT_EVENT,
} from '../events/event-bus.js';

// ─── Inject Templates ────────────────────────────────────────────────────────

const GOAL_TEMPLATES = [
  'GOAL. Your tribe called it.',
  'GOAL. The fire rises.',
  'GOAL. Feel that.',
];

const RED_CARD_TEMPLATES = [
  'Red card. Momentum shifts.',
  'Red card. Everything changes now.',
  'Red card. Watch what happens next.',
];

const ODDS_SHIFT_TEMPLATES = [
  'The market just flipped.',
  'Odds shifted. Something\'s coming.',
  'Big swing. The market feels it.',
];

const STATE_CHANGE_TEMPLATES: Record<string, string[]> = {
  HT: ['Half-time. Breathe.'],
  FT: ['Full-time.'],
  ET: ['Extra time. Stay close.'],
  AET: ['After extra time. It\'s done.'],
};

// ─── Emotion Mapping ─────────────────────────────────────────────────────────

const EMOTION_MAP: Record<string, KeeperInjectPayload['emotion']> = {
  [GOAL_EVENT]: 'celebration',
  [RED_CARD_EVENT]: 'tension',
  [ODDS_SHIFT_EVENT]: 'tension',
  [STATE_CHANGE_EVENT]: 'neutral',
};

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_INJECTS_PER_MATCH = 10;
const ODDS_SHIFT_INJECT_THRESHOLD = 20; // Only inject if magnitude > 20%
const LIVENESS_CHECK_INTERVAL_MS = 60_000; // Check every 60 seconds
const LIVENESS_SILENCE_THRESHOLD_MS = 600_000; // 10 minutes of silence triggers "Still here."

// ─── TribeId Resolver ────────────────────────────────────────────────────────

/**
 * Resolves a fixtureId to the list of tribeIds that should receive the inject.
 * For hackathon: returns a default tribe. In production, this queries presence.
 */
export type TribeIdResolver = (fixtureId: string) => string[];

// ─── KeeperInjectService ─────────────────────────────────────────────────────

/**
 * Generates and broadcasts single-line Keeper injects to the Campfire
 * in response to match events. Uses simple templates (no LLM needed for hackathon).
 *
 * Hooks into KeeperEvaluator's onDecision callback. When the decision action
 * is 'inject', the service selects a template, picks a random message,
 * and broadcasts via WebSocket.
 *
 * Constraints:
 * - Max 10 injects per match (enforced by evaluator, double-checked here)
 * - GOAL_EVENT → within 2s
 * - RED_CARD_EVENT → within 2s
 * - ODDS_SHIFT_EVENT with magnitude > 20% → within 5s
 * - STATE_CHANGE (HT/FT/ET) → inject with neutral emotion
 */
export class KeeperInjectService {
  private evaluator: KeeperEvaluator;
  private wsServer: CampfireWSServer;
  private tribeIdResolver: TribeIdResolver;
  private injectCounts: Map<string, number> = new Map();
  private lastInjectTime: Map<string, number> = new Map();
  private livenessTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(
    evaluator: KeeperEvaluator,
    wsServer: CampfireWSServer,
    tribeIdResolver: TribeIdResolver
  ) {
    this.evaluator = evaluator;
    this.wsServer = wsServer;
    this.tribeIdResolver = tribeIdResolver;

    // Hook into evaluator's decision callback
    this.evaluator.setOnDecision((decision) => this.handleDecision(decision));
  }

  /**
   * Handle a Keeper decision. Only acts on 'inject' decisions.
   */
  handleDecision(decision: KeeperDecision): void {
    if (decision.action !== 'inject') return;

    const { fixtureId, eventType } = decision;

    // Double-check inject count limit
    const count = this.injectCounts.get(fixtureId) ?? 0;
    if (count >= MAX_INJECTS_PER_MATCH) return;

    // For ODDS_SHIFT: only inject if magnitude > 20%
    // The evaluator routes odds shifts to read_prompt, not inject.
    // But if it did come as inject (future change), we'd check threshold here.
    // For now, odds shift injects are triggered manually via injectForOddsShift.

    const message = this.selectTemplate(eventType, decision.reason);
    if (!message) return;

    const emotion = EMOTION_MAP[eventType] ?? 'neutral';
    const payload: KeeperInjectPayload = { message, emotion };

    // Broadcast to all tribes watching this fixture
    const tribeIds = this.tribeIdResolver(fixtureId);
    for (const tribeId of tribeIds) {
      this.wsServer.broadcastKeeperInject(tribeId, fixtureId, payload);
    }

    // Increment inject count and record last inject time
    this.injectCounts.set(fixtureId, count + 1);
    this.lastInjectTime.set(fixtureId, Date.now());
  }

  /**
   * Explicitly handle an ODDS_SHIFT inject when magnitude > 20%.
   * Called directly (not through evaluator) since evaluator routes odds to read_prompt.
   */
  injectForOddsShift(fixtureId: string, percentChange: number): void {
    // Only inject if magnitude > 20%
    if (Math.abs(percentChange) <= ODDS_SHIFT_INJECT_THRESHOLD) return;

    const count = this.injectCounts.get(fixtureId) ?? 0;
    if (count >= MAX_INJECTS_PER_MATCH) return;

    const message = pickRandom(ODDS_SHIFT_TEMPLATES);
    const payload: KeeperInjectPayload = { message, emotion: 'tension' };

    const tribeIds = this.tribeIdResolver(fixtureId);
    for (const tribeId of tribeIds) {
      this.wsServer.broadcastKeeperInject(tribeId, fixtureId, payload);
    }

    this.injectCounts.set(fixtureId, count + 1);
    this.lastInjectTime.set(fixtureId, Date.now());
  }

  /**
   * Select a template message based on event type and decision reason.
   */
  selectTemplate(eventType: string, reason: string): string | null {
    switch (eventType) {
      case GOAL_EVENT:
        return pickRandom(GOAL_TEMPLATES);

      case RED_CARD_EVENT:
        return pickRandom(RED_CARD_TEMPLATES);

      case ODDS_SHIFT_EVENT:
        return pickRandom(ODDS_SHIFT_TEMPLATES);

      case STATE_CHANGE_EVENT: {
        // Extract the state from reason (e.g., 'state_change_ht' → 'HT')
        const stateMatch = reason.match(/state_change_(\w+)/);
        if (stateMatch) {
          const state = stateMatch[1].toUpperCase();
          const templates = STATE_CHANGE_TEMPLATES[state];
          if (templates) return pickRandom(templates);
        }
        return null;
      }

      default:
        return null;
    }
  }

  /**
   * Start a liveness timer for a fixture.
   * Checks every 60s — if more than 10 minutes have elapsed since the last
   * inject, sends a minimal "Still here." presence line.
   * Resets after any inject (tracked via lastInjectTime).
   */
  startLivenessTimer(fixtureId: string): void {
    // Don't start a duplicate timer
    if (this.livenessTimers.has(fixtureId)) return;

    // Seed the last inject time to now so the 10-min window starts fresh
    this.lastInjectTime.set(fixtureId, Date.now());

    const timer = setInterval(() => {
      const lastTime = this.lastInjectTime.get(fixtureId) ?? 0;
      const elapsed = Date.now() - lastTime;

      if (elapsed >= LIVENESS_SILENCE_THRESHOLD_MS) {
        // Still under max inject limit?
        const count = this.injectCounts.get(fixtureId) ?? 0;
        if (count >= MAX_INJECTS_PER_MATCH) return;

        const payload: KeeperInjectPayload = { message: 'Still here.', emotion: 'neutral' };

        const tribeIds = this.tribeIdResolver(fixtureId);
        for (const tribeId of tribeIds) {
          this.wsServer.broadcastKeeperInject(tribeId, fixtureId, payload);
        }

        this.injectCounts.set(fixtureId, count + 1);
        this.lastInjectTime.set(fixtureId, Date.now());
      }
    }, LIVENESS_CHECK_INTERVAL_MS);

    this.livenessTimers.set(fixtureId, timer);
  }

  /**
   * Stop the liveness timer for a fixture.
   */
  stopLivenessTimer(fixtureId: string): void {
    const timer = this.livenessTimers.get(fixtureId);
    if (timer) {
      clearInterval(timer);
      this.livenessTimers.delete(fixtureId);
    }
  }

  /**
   * Get current inject count for a fixture.
   */
  getInjectCount(fixtureId: string): number {
    return this.injectCounts.get(fixtureId) ?? 0;
  }

  /**
   * Reset inject tracking for a fixture (e.g., when match ends).
   */
  resetFixture(fixtureId: string): void {
    this.injectCounts.delete(fixtureId);
    this.lastInjectTime.delete(fixtureId);
    this.stopLivenessTimer(fixtureId);
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Pick a random element from an array.
 */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Exported Templates (for testing) ────────────────────────────────────────

export const TEMPLATES = {
  GOAL: GOAL_TEMPLATES,
  RED_CARD: RED_CARD_TEMPLATES,
  ODDS_SHIFT: ODDS_SHIFT_TEMPLATES,
  STATE_CHANGE: STATE_CHANGE_TEMPLATES,
};

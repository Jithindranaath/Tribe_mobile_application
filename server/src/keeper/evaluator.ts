import {
  EventBus,
  EventType,
  EventMap,
  GOAL_EVENT,
  RED_CARD_EVENT,
  STATE_CHANGE_EVENT,
  ODDS_SHIFT_EVENT,
  GoalEvent,
  RedCardEvent,
  StateChangeEvent,
  OddsShiftEvent,
} from '../events/event-bus.js';
import { KeeperDecision, FixtureState, OnDecisionCallback } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_READ_PROMPTS_PER_MATCH = 5;
const MAX_INJECTS_PER_MATCH = 10;

// ─── KeeperEvaluator ─────────────────────────────────────────────────────────

/**
 * The Keeper's decision engine. Subscribes to the internal event bus and
 * evaluates each match event to decide whether to surface a Read prompt,
 * send a Keeper inject, or remain silent.
 *
 * Enforces:
 * - Max 5 Read prompts per 90-minute match window
 * - Max 10 injects per match
 * - Silence during penalty kicks
 */
export class KeeperEvaluator {
  private bus: EventBus;
  private fixtureStates: Map<string, FixtureState> = new Map();
  private onDecision: OnDecisionCallback | null = null;

  // Store bound handlers for clean unsubscription
  private goalHandler: (event: GoalEvent) => void;
  private redCardHandler: (event: RedCardEvent) => void;
  private stateChangeHandler: (event: StateChangeEvent) => void;
  private oddsShiftHandler: (event: OddsShiftEvent) => void;

  constructor(bus: EventBus) {
    this.bus = bus;

    // Bind handlers so we can remove them later
    this.goalHandler = (event) => this.handleEvent(GOAL_EVENT, event);
    this.redCardHandler = (event) => this.handleEvent(RED_CARD_EVENT, event);
    this.stateChangeHandler = (event) => this.handleEvent(STATE_CHANGE_EVENT, event);
    this.oddsShiftHandler = (event) => this.handleEvent(ODDS_SHIFT_EVENT, event);
  }

  /**
   * Subscribe to all event types on the event bus.
   */
  start(): void {
    this.bus.on(GOAL_EVENT, this.goalHandler);
    this.bus.on(RED_CARD_EVENT, this.redCardHandler);
    this.bus.on(STATE_CHANGE_EVENT, this.stateChangeHandler);
    this.bus.on(ODDS_SHIFT_EVENT, this.oddsShiftHandler);
  }

  /**
   * Unsubscribe from all event types.
   */
  stop(): void {
    this.bus.off(GOAL_EVENT, this.goalHandler);
    this.bus.off(RED_CARD_EVENT, this.redCardHandler);
    this.bus.off(STATE_CHANGE_EVENT, this.stateChangeHandler);
    this.bus.off(ODDS_SHIFT_EVENT, this.oddsShiftHandler);
  }

  /**
   * Set a callback to receive decisions for downstream handling.
   */
  setOnDecision(callback: OnDecisionCallback): void {
    this.onDecision = callback;
  }

  /**
   * Get the per-fixture state (for inspection/testing).
   */
  getFixtureState(fixtureId: string): FixtureState | undefined {
    return this.fixtureStates.get(fixtureId);
  }

  /**
   * Clear state for a fixture (e.g., when match ends or for testing).
   */
  resetFixture(fixtureId: string): void {
    this.fixtureStates.delete(fixtureId);
  }

  /**
   * Core evaluation logic — determines what action the Keeper should take.
   * Public for direct testing without event bus.
   */
  evaluateEvent<T extends EventType>(eventType: T, event: EventMap[T]): KeeperDecision {
    const fixtureId = event.fixtureId;
    const state = this.getOrCreateFixtureState(fixtureId);

    // Handle STATE_CHANGE_EVENT first — may activate or deactivate penalty silence
    if (eventType === STATE_CHANGE_EVENT) {
      return this.evaluateStateChange(state, event as StateChangeEvent);
    }

    // Rule: Force silence during penalty kicks (for non-state-change events)
    if (state.isPenaltyActive) {
      return { action: 'silent', fixtureId, eventType, reason: 'penalty_active' };
    }

    // Handle GOAL_EVENT — always worth reacting to
    if (eventType === GOAL_EVENT) {
      return this.evaluateGoal(state, event as GoalEvent);
    }

    // Handle RED_CARD_EVENT — inject action
    if (eventType === RED_CARD_EVENT) {
      return this.evaluateRedCard(state, event as RedCardEvent);
    }

    // Handle ODDS_SHIFT_EVENT — read prompt if under limit
    if (eventType === ODDS_SHIFT_EVENT) {
      return this.evaluateOddsShift(state, event as OddsShiftEvent);
    }

    return { action: 'silent', fixtureId, eventType, reason: 'unknown_event_type' };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private handleEvent<T extends EventType>(eventType: T, event: EventMap[T]): void {
    const decision = this.evaluateEvent(eventType, event);

    // Update counters based on decision
    const state = this.getOrCreateFixtureState(event.fixtureId);
    if (decision.action === 'read_prompt') {
      state.readsSurfaced++;
    } else if (decision.action === 'inject') {
      state.injectsSent++;
      state.lastInjectTime = Date.now();
    }

    // Notify downstream
    if (this.onDecision) {
      this.onDecision(decision);
    }
  }

  private getOrCreateFixtureState(fixtureId: string): FixtureState {
    let state = this.fixtureStates.get(fixtureId);
    if (!state) {
      state = {
        readsSurfaced: 0,
        injectsSent: 0,
        lastInjectTime: null,
        isPenaltyActive: false,
      };
      this.fixtureStates.set(fixtureId, state);
    }
    return state;
  }

  private evaluateGoal(state: FixtureState, event: GoalEvent): KeeperDecision {
    const fixtureId = event.fixtureId;

    // Goals are always worth reacting to — prefer read_prompt if under limit
    if (state.readsSurfaced < MAX_READ_PROMPTS_PER_MATCH) {
      return { action: 'read_prompt', fixtureId, eventType: GOAL_EVENT, reason: 'goal_read_prompt' };
    }

    // Over read limit but can still inject
    if (state.injectsSent < MAX_INJECTS_PER_MATCH) {
      return { action: 'inject', fixtureId, eventType: GOAL_EVENT, reason: 'goal_inject_read_limit_reached' };
    }

    // Both limits hit
    return { action: 'silent', fixtureId, eventType: GOAL_EVENT, reason: 'goal_all_limits_reached' };
  }

  private evaluateRedCard(state: FixtureState, event: RedCardEvent): KeeperDecision {
    const fixtureId = event.fixtureId;

    // Red cards always get an inject (if under inject limit)
    if (state.injectsSent < MAX_INJECTS_PER_MATCH) {
      return { action: 'inject', fixtureId, eventType: RED_CARD_EVENT, reason: 'red_card_inject' };
    }

    return { action: 'silent', fixtureId, eventType: RED_CARD_EVENT, reason: 'red_card_inject_limit_reached' };
  }

  private evaluateStateChange(state: FixtureState, event: StateChangeEvent): KeeperDecision {
    const fixtureId = event.fixtureId;
    const newState = event.newGameState.toUpperCase();

    // Penalty kick detection — force silence
    if (newState === 'PEN' || newState === 'PENALTY' || newState === 'PK') {
      state.isPenaltyActive = true;
      return { action: 'silent', fixtureId, eventType: STATE_CHANGE_EVENT, reason: 'penalty_started' };
    }

    // End of penalty phase — resume normal operation
    if (state.isPenaltyActive) {
      state.isPenaltyActive = false;
    }

    // Interesting state changes (HT, FT, ET) → inject
    if (newState === 'HT' || newState === 'FT' || newState === 'ET' || newState === 'AET') {
      if (state.injectsSent < MAX_INJECTS_PER_MATCH) {
        return { action: 'inject', fixtureId, eventType: STATE_CHANGE_EVENT, reason: `state_change_${newState.toLowerCase()}` };
      }
      return { action: 'silent', fixtureId, eventType: STATE_CHANGE_EVENT, reason: 'state_change_inject_limit_reached' };
    }

    // Other state changes (2H, etc.) — not interesting enough to react
    return { action: 'silent', fixtureId, eventType: STATE_CHANGE_EVENT, reason: 'state_change_not_interesting' };
  }

  private evaluateOddsShift(state: FixtureState, event: OddsShiftEvent): KeeperDecision {
    const fixtureId = event.fixtureId;

    // Odds shifts get a read prompt if under limit
    if (state.readsSurfaced < MAX_READ_PROMPTS_PER_MATCH) {
      return { action: 'read_prompt', fixtureId, eventType: ODDS_SHIFT_EVENT, reason: 'odds_shift_read_prompt' };
    }

    return { action: 'silent', fixtureId, eventType: ODDS_SHIFT_EVENT, reason: 'odds_shift_read_limit_reached' };
  }
}

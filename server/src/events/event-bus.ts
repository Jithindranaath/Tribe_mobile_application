import { EventEmitter } from 'node:events';

// ─── Event Type Constants ────────────────────────────────────────────────────

export const GOAL_EVENT = 'GOAL_EVENT' as const;
export const RED_CARD_EVENT = 'RED_CARD_EVENT' as const;
export const STATE_CHANGE_EVENT = 'STATE_CHANGE_EVENT' as const;
export const ODDS_SHIFT_EVENT = 'ODDS_SHIFT_EVENT' as const;

export type EventType =
  | typeof GOAL_EVENT
  | typeof RED_CARD_EVENT
  | typeof STATE_CHANGE_EVENT
  | typeof ODDS_SHIFT_EVENT;

// ─── Event Interfaces ────────────────────────────────────────────────────────

export interface GoalEvent {
  fixtureId: string;
  seq: number;
  timestamp: number;
  gameState: string;
  team: 'home' | 'away';
  player?: string;
}

export interface RedCardEvent {
  fixtureId: string;
  seq: number;
  timestamp: number;
  gameState: string;
  player?: string;
}

export interface StateChangeEvent {
  fixtureId: string;
  seq: number;
  timestamp: number;
  newGameState: string;
}

export interface OddsShiftEvent {
  fixtureId: string;
  timestamp: number;
  market: string;
  oldPrice: number;
  newPrice: number;
  percentChange: number;
}

// ─── Event Map (type → payload) ─────────────────────────────────────────────

export interface EventMap {
  [GOAL_EVENT]: GoalEvent;
  [RED_CARD_EVENT]: RedCardEvent;
  [STATE_CHANGE_EVENT]: StateChangeEvent;
  [ODDS_SHIFT_EVENT]: OddsShiftEvent;
}

// ─── Typed EventBus Class ────────────────────────────────────────────────────

export class EventBus {
  private emitter = new EventEmitter();

  /**
   * Emit a typed event to all subscribers.
   */
  emit<T extends EventType>(type: T, event: EventMap[T]): boolean {
    return this.emitter.emit(type, event);
  }

  /**
   * Subscribe to a typed event.
   */
  on<T extends EventType>(type: T, handler: (event: EventMap[T]) => void): this {
    this.emitter.on(type, handler as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Unsubscribe a handler from a typed event.
   */
  off<T extends EventType>(type: T, handler: (event: EventMap[T]) => void): this {
    this.emitter.off(type, handler as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Subscribe to a typed event for a single emission only.
   */
  once<T extends EventType>(type: T, handler: (event: EventMap[T]) => void): this {
    this.emitter.once(type, handler as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Remove all listeners, optionally for a specific event type.
   */
  removeAllListeners(type?: EventType): this {
    if (type) {
      this.emitter.removeAllListeners(type);
    } else {
      this.emitter.removeAllListeners();
    }
    return this;
  }

  /**
   * Returns the number of listeners for a given event type.
   */
  listenerCount(type: EventType): number {
    return this.emitter.listenerCount(type);
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

export const eventBus = new EventBus();

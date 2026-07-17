/**
 * TxLINE Scores Stream Event Normalizer
 *
 * Parses raw TxLINE SSE score events and:
 *   1. Detects event type (goal, red card, state change)
 *   2. Emits typed events on the internal event bus
 *   3. Persists raw events to match_events table for audit trail
 *
 * Requirements: 2.5, 2.6, 2.7, 4.6, 25.3
 */

import {
  eventBus,
  GOAL_EVENT,
  RED_CARD_EVENT,
  STATE_CHANGE_EVENT,
} from '../events/event-bus.js';
import type { GoalEvent, RedCardEvent, StateChangeEvent } from '../events/event-bus.js';
import { getSupabaseClient } from '../lib/supabase.js';
import type { MatchEventsInsert } from '../db/schema.js';

// ─── TxLINE Raw Event Shape ──────────────────────────────────────────────────

/**
 * Raw TxLINE scores stream event shape.
 * TxLINE sends JSON with these fields via SSE `data:` lines.
 */
export interface TxLINERawScoreEvent {
  fixtureId: string;
  seq: number;
  ts: number;
  gameState: string;
  homeScore: number;
  awayScore: number;
  incidents?: TxLINEIncident[];
}

export interface TxLINEIncident {
  type: string; // e.g. 'goal', 'red_card', 'yellow_card', 'substitution'
  team: 'home' | 'away';
  player?: string;
}

// ─── Valid game states that represent state transitions ───────────────────────

const STATE_CHANGE_STATES = new Set(['HT', '2H', 'FT', 'ET', 'PEN']);

// ─── Previous scores cache (detect goals by score change) ────────────────────

const previousScores = new Map<string, { home: number; away: number }>();

// ─── Core Normalizer ─────────────────────────────────────────────────────────

/**
 * Normalizes a raw TxLINE scores stream event.
 *
 * Detection logic:
 *   - Goals: detected via score change comparison OR incidents with type='goal'
 *   - Red cards: detected via incidents with type='red_card'
 *   - State changes: detected when gameState is HT, 2H, FT, ET, or PEN
 *
 * Each detected event is:
 *   1. Emitted on the internal event bus
 *   2. Stored in the match_events table for audit
 */
export async function normalizeScoreEvent(rawEvent: TxLINERawScoreEvent): Promise<void> {
  const { fixtureId, seq, ts, gameState, homeScore, awayScore, incidents } = rawEvent;

  // ── Persist raw event to match_events for audit trail ────────────────────
  await storeMatchEvent(fixtureId, seq, ts, gameState, rawEvent);

  // ── Detect goals ─────────────────────────────────────────────────────────
  const goalDetected = detectGoals(fixtureId, homeScore, awayScore, incidents);
  if (goalDetected) {
    const goalEvent: GoalEvent = {
      fixtureId,
      seq,
      timestamp: ts,
      gameState,
      team: goalDetected.team,
      player: goalDetected.player,
    };
    eventBus.emit(GOAL_EVENT, goalEvent);
  }

  // ── Detect red cards ─────────────────────────────────────────────────────
  const redCards = detectRedCards(incidents);
  for (const card of redCards) {
    const redCardEvent: RedCardEvent = {
      fixtureId,
      seq,
      timestamp: ts,
      gameState,
      player: card.player,
    };
    eventBus.emit(RED_CARD_EVENT, redCardEvent);
  }

  // ── Detect state changes ─────────────────────────────────────────────────
  if (detectStateChange(gameState)) {
    const stateChangeEvent: StateChangeEvent = {
      fixtureId,
      seq,
      timestamp: ts,
      newGameState: gameState,
    };
    eventBus.emit(STATE_CHANGE_EVENT, stateChangeEvent);
  }

  // ── Update cached scores ─────────────────────────────────────────────────
  previousScores.set(fixtureId, { home: homeScore, away: awayScore });
}

// ─── Detection Helpers ───────────────────────────────────────────────────────

/**
 * Detects a goal by comparing current scores against cached previous scores,
 * or by finding a 'goal' incident in the incidents array.
 *
 * Returns the scoring team and optional player, or null if no goal detected.
 */
function detectGoals(
  fixtureId: string,
  homeScore: number,
  awayScore: number,
  incidents?: TxLINEIncident[],
): { team: 'home' | 'away'; player?: string } | null {
  // Check incidents array first — most reliable source
  if (incidents && incidents.length > 0) {
    const goalIncident = incidents.find((i) => i.type === 'goal');
    if (goalIncident) {
      return { team: goalIncident.team, player: goalIncident.player };
    }
  }

  // Fallback: detect via score change
  const prev = previousScores.get(fixtureId);
  if (prev) {
    if (homeScore > prev.home) {
      return { team: 'home' };
    }
    if (awayScore > prev.away) {
      return { team: 'away' };
    }
  }

  return null;
}

/**
 * Detects red card incidents from the incidents array.
 * Returns all red card incidents found (could be multiple in edge cases).
 */
function detectRedCards(
  incidents?: TxLINEIncident[],
): Array<{ player?: string }> {
  if (!incidents || incidents.length === 0) return [];

  return incidents
    .filter((i) => i.type === 'red_card')
    .map((i) => ({ player: i.player }));
}

/**
 * Detects whether the gameState represents a meaningful state transition.
 * Valid state changes: HT (half-time), 2H (second half), FT (full-time),
 * ET (extra time), PEN (penalties).
 */
function detectStateChange(gameState: string): boolean {
  return STATE_CHANGE_STATES.has(gameState);
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Stores the raw TxLINE event in match_events table for audit trail.
 * Requirement 4.6 / 25.3: all TxLINE events stored with fixture_id, seq, ts,
 * game_state, and full event_json.
 */
async function storeMatchEvent(
  fixtureId: string,
  seq: number,
  ts: number,
  gameState: string,
  rawEvent: TxLINERawScoreEvent,
): Promise<void> {
  const supabase = getSupabaseClient();

  const record: MatchEventsInsert = {
    fixture_id: Number(fixtureId),
    seq,
    ts,
    game_state: gameState,
    event_json: rawEvent as unknown as Record<string, unknown>,
  };

  const { error } = await supabase.from('match_events').insert(record);

  if (error) {
    // Log but don't throw — event processing shouldn't block on persistence failure
    console.error('[normalizer] Failed to store match event:', error.message);
  }
}

// ─── Cache Management (for testing) ─────────────────────────────────────────

/**
 * Clears the previous scores cache. Useful for testing.
 */
export function resetScoresCache(): void {
  previousScores.clear();
}

/**
 * Sets a previous score for a fixture. Useful for testing score-change detection.
 */
export function setPreviousScore(
  fixtureId: string,
  home: number,
  away: number,
): void {
  previousScores.set(fixtureId, { home, away });
}

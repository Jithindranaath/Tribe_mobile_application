/**
 * TxLINE Scores Stream Event Normalizer
 *
 * Parses raw TxLINE score events (from both the live SSE stream and the
 * historical replay endpoint — both use the same per-action event shape) and:
 *   1. Detects event type (goal, red card, state change)
 *   2. Emits typed events on the internal event bus
 *   3. Persists raw events to match_events table for audit trail
 *
 * The real TxLINE payload is a PascalCase per-action event keyed by numeric
 * `Stats` codes, NOT a flat camelCase {fixtureId, homeScore, awayScore,
 * incidents} shape. See tx-on-chain/documentation/scores/soccer-feed.mdx for
 * the authoritative StatusId phase encoding and Stats key encoding.
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

// ─── TxLINE Raw Event Shape (real, PascalCase, per-action) ───────────────────

/**
 * Raw TxLINE score event shape, as actually sent by both the live SSE stream
 * and the historical replay endpoint. Heartbeat messages omit `FixtureId`
 * entirely (e.g. `{"Ts":1784402672}`) and must be treated as no-ops.
 */
export interface TxLINERawScoreEvent {
  FixtureId?: number;
  GameState?: string;
  Action?: string;
  Id?: number;
  Ts?: number;
  Seq?: number;
  StatusId?: number;
  Participant1IsHome?: boolean;
  Participant1Id?: number;
  Participant2Id?: number;
  Clock?: { Running: boolean; Seconds: number };
  /** Numeric stat-key -> value. Key 1-8 = Total period; see soccer-feed.mdx for period prefixes. */
  Stats?: Record<string, number>;
  [key: string]: unknown;
}

// ─── Stat key encoding (soccer-feed.mdx: Full Game Stats, period=Total) ──────

const STAT_KEY_P1_GOALS = '1';
const STAT_KEY_P2_GOALS = '2';
const STAT_KEY_P1_RED_CARDS = '5';
const STAT_KEY_P2_RED_CARDS = '6';

// ─── Game phase encoding (soccer-feed.mdx: Game Phase Encoding) ──────────────

const GAME_PHASE_BY_STATUS_ID: Record<number, string> = {
  1: 'NS', 2: 'H1', 3: 'HT', 4: 'H2', 5: 'F', 6: 'WET', 7: 'ET1', 8: 'HTET',
  9: 'ET2', 10: 'FET', 11: 'WPE', 12: 'PE', 13: 'FPE', 14: 'I', 15: 'A',
  16: 'C', 17: 'TXCC', 18: 'TXCS', 19: 'P', 100: 'FINISHED',
};

/** Phases considered a meaningful state transition worth surfacing. */
const STATE_CHANGE_PHASES = new Set(['HT', 'H2', 'F', 'ET1', 'ET2', 'PE', 'FINISHED']);

// ─── Previous match state cache (detect deltas across events) ────────────────

interface CachedMatchState {
  p1Goals: number;
  p2Goals: number;
  p1RedCards: number;
  p2RedCards: number;
  statusId: number | undefined;
}

const previousMatchState = new Map<string, CachedMatchState>();

// ─── Core Normalizer ─────────────────────────────────────────────────────────

/**
 * Normalizes a raw TxLINE score event.
 *
 * Detection logic (all delta-based against the last seen state for the fixture,
 * since the live/historical feed sends many non-scoring action events per
 * fixture and re-sends the current totals on every message):
 *   - Goals: Stats["1"] / Stats["2"] (P1/P2 total goals) increasing
 *   - Red cards: Stats["5"] / Stats["6"] (P1/P2 total red cards) increasing
 *   - State changes: StatusId transitioning into a meaningful phase
 *
 * Heartbeat messages (no FixtureId) are no-ops — not persisted, not detected.
 */
export async function normalizeScoreEvent(rawEvent: TxLINERawScoreEvent): Promise<void> {
  if (rawEvent.FixtureId === undefined || rawEvent.FixtureId === null) {
    // Heartbeat-only message (e.g. `{"Ts":...}`) — no-op, same pattern as odds stream.
    return;
  }

  const fixtureId = String(rawEvent.FixtureId);
  const seq = rawEvent.Seq ?? 0;
  const ts = rawEvent.Ts ?? Date.now();
  const statusId = rawEvent.StatusId;
  const gameState =
    (statusId !== undefined ? GAME_PHASE_BY_STATUS_ID[statusId] : undefined) ??
    rawEvent.GameState ??
    'UNKNOWN';
  const stats = rawEvent.Stats ?? {};
  const participant1IsHome = rawEvent.Participant1IsHome ?? true;
  const clockSeconds = rawEvent.Clock?.Seconds;

  // ── Persist raw event to match_events for audit trail ────────────────────
  await storeMatchEvent(fixtureId, seq, ts, gameState, rawEvent);

  const p1Goals = stats[STAT_KEY_P1_GOALS] ?? 0;
  const p2Goals = stats[STAT_KEY_P2_GOALS] ?? 0;
  const p1RedCards = stats[STAT_KEY_P1_RED_CARDS] ?? 0;
  const p2RedCards = stats[STAT_KEY_P2_RED_CARDS] ?? 0;

  const prev = previousMatchState.get(fixtureId);

  // VAR reviews produce transient Stats fluctuations on non-'goal' actions
  // (e.g. a goal briefly counted then "action_amend"-ed back out during
  // review, or "var_end"/"corner" events carrying a stale goals count from
  // a different code path) — comparing against every event's goals count
  // causes spurious extra GOAL_EVENTs. Confirmed against a real match: only
  // Action === 'goal' events reliably reflect the confirmed score; only
  // those are used for goal delta detection and cache updates.
  const isGoalAction = rawEvent.Action === 'goal';

  if (prev) {
    if (isGoalAction) {
      // ── Detect goals (delta on total goals per participant) ────────────────
      emitGoalDeltas(fixtureId, seq, ts, gameState, p1Goals - prev.p1Goals, participant1IsHome ? 'home' : 'away', clockSeconds);
      emitGoalDeltas(fixtureId, seq, ts, gameState, p2Goals - prev.p2Goals, participant1IsHome ? 'away' : 'home', clockSeconds);
    }

    // ── Detect red cards (delta on total red cards per participant) ────────
    emitRedCardDeltas(fixtureId, seq, ts, gameState, p1RedCards - prev.p1RedCards);
    emitRedCardDeltas(fixtureId, seq, ts, gameState, p2RedCards - prev.p2RedCards);

    // ── Detect state changes (StatusId transition into a meaningful phase) ─
    if (
      statusId !== undefined &&
      prev.statusId !== statusId &&
      STATE_CHANGE_PHASES.has(gameState)
    ) {
      const stateChangeEvent: StateChangeEvent = {
        fixtureId,
        seq,
        timestamp: ts,
        newGameState: gameState,
      };
      eventBus.emit(STATE_CHANGE_EVENT, stateChangeEvent);
    }
  }

  // ── Update cached state ───────────────────────────────────────────────────
  // Goals only update from confirmed 'goal'-action events (see above); every
  // other field updates from every event as before.
  previousMatchState.set(fixtureId, {
    p1Goals: isGoalAction ? p1Goals : (prev?.p1Goals ?? p1Goals),
    p2Goals: isGoalAction ? p2Goals : (prev?.p2Goals ?? p2Goals),
    p1RedCards,
    p2RedCards,
    statusId,
  });
}

// ─── Detection Helpers ───────────────────────────────────────────────────────

/** Emits one GOAL_EVENT per goal in a positive delta (defensive against multi-goal batches). */
function emitGoalDeltas(
  fixtureId: string,
  seq: number,
  ts: number,
  gameState: string,
  delta: number,
  team: 'home' | 'away',
  clockSeconds?: number,
): void {
  if (delta <= 0) return;
  for (let i = 0; i < delta; i++) {
    const goalEvent: GoalEvent = { fixtureId, seq, timestamp: ts, gameState, team, clockSeconds };
    eventBus.emit(GOAL_EVENT, goalEvent);
  }
}

/** Emits one RED_CARD_EVENT per card in a positive delta. Player name isn't in aggregate Stats. */
function emitRedCardDeltas(
  fixtureId: string,
  seq: number,
  ts: number,
  gameState: string,
  delta: number,
): void {
  if (delta <= 0) return;
  for (let i = 0; i < delta; i++) {
    const redCardEvent: RedCardEvent = { fixtureId, seq, timestamp: ts, gameState };
    eventBus.emit(RED_CARD_EVENT, redCardEvent);
  }
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
 * Clears the previous match state cache. Useful for testing.
 */
export function resetScoresCache(): void {
  previousMatchState.clear();
}

/**
 * Clears cached state for a single fixture only. Needed before re-replaying the
 * same fixtureId in the same server process (e.g. an accelerated smoke test
 * followed by a real-time run) — without this, goal/red-card detection diffs
 * the new run's events against the previous run's leftover final score instead
 * of a fresh 0-0 baseline, producing spurious or missing goal events.
 */
export function resetScoresCacheForFixture(fixtureId: string): void {
  previousMatchState.delete(fixtureId);
}

/**
 * Seeds cached match state for a fixture. Useful for testing delta detection.
 */
export function setPreviousScore(
  fixtureId: string,
  p1Goals: number,
  p2Goals: number,
  p1RedCards = 0,
  p2RedCards = 0,
  statusId?: number,
): void {
  previousMatchState.set(fixtureId, { p1Goals, p2Goals, p1RedCards, p2RedCards, statusId });
}

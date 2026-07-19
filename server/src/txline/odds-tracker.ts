/**
 * TxLINE Odds Shift Detection
 *
 * Tracks odds price changes within 60-second rolling windows per fixture per market.
 * When price change exceeds 15%, emits ODDS_SHIFT_EVENT on the internal event bus.
 * All ticks are persisted to the odds_ticks table for audit trail.
 *
 * Requirements: 2.8, 4.7
 */

import {
  eventBus,
  ODDS_SHIFT_EVENT,
} from '../events/event-bus.js';
import type { OddsShiftEvent } from '../events/event-bus.js';
import { getSupabaseClient } from '../lib/supabase.js';
import type { OddsTicksInsert } from '../db/schema.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Rolling window size in seconds (60 seconds). TxLINE timestamps are Unix seconds. */
const WINDOW_SECONDS = 60;

/** Threshold for odds shift detection (15%). */
const SHIFT_THRESHOLD = 0.15;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single price tick within the rolling window. */
interface PriceTick {
  timestamp: number;
  price: number;
}

/** Key for identifying a unique fixture+market window. */
type WindowKey = string;

// ─── OddsTracker Class ───────────────────────────────────────────────────────

/**
 * Maintains a rolling window of odds prices per fixture per market.
 * On each incoming tick:
 *   1. Stores the tick in the odds_ticks table via Supabase
 *   2. Cleans up old entries (older than 60s) from the window
 *   3. Compares current price against the oldest price in the window
 *   4. Emits ODDS_SHIFT_EVENT if |percentChange| > 15%
 */
export class OddsTracker {
  /** Rolling price windows keyed by `${fixtureId}::${market}`. */
  private windows = new Map<WindowKey, PriceTick[]>();

  /**
   * Processes an incoming odds tick.
   *
   * @param fixtureId - The TxLINE fixture identifier
   * @param timestamp - Unix timestamp (ms) of the tick
   * @param market - Market identifier (e.g. 'match_winner', 'next_goal')
   * @param prices - Price map (e.g. { home: 2.10, away: 3.50, draw: 3.20 })
   */
  async processOddsTick(
    fixtureId: string,
    timestamp: number,
    market: string,
    prices: Record<string, number>,
  ): Promise<void> {
    // 1. Store in odds_ticks table
    await this.storeOddsTick(fixtureId, timestamp, market, prices);

    // 2. For each price in the market, track and detect shifts
    for (const [outcome, price] of Object.entries(prices)) {
      const key = this.makeKey(fixtureId, market, outcome);
      this.trackPrice(key, timestamp, price);

      // 3. Check for shift
      const shift = this.detectShift(key, price);
      if (shift) {
        const oddsShiftEvent: OddsShiftEvent = {
          fixtureId,
          timestamp,
          market,
          oldPrice: shift.oldPrice,
          newPrice: price,
          percentChange: shift.percentChange,
        };
        eventBus.emit(ODDS_SHIFT_EVENT, oddsShiftEvent);
      }
    }
  }

  // ─── Internal Methods ────────────────────────────────────────────────────

  /**
   * Adds a price tick to the rolling window and cleans up expired entries.
   */
  private trackPrice(key: WindowKey, timestamp: number, price: number): void {
    if (!this.windows.has(key)) {
      this.windows.set(key, []);
    }

    const window = this.windows.get(key)!;

    // Add new tick
    window.push({ timestamp, price });

    // Clean up ticks older than 60s from the current timestamp
    const cutoff = timestamp - WINDOW_SECONDS;
    while (window.length > 0 && window[0].timestamp < cutoff) {
      window.shift();
    }
  }

  /**
   * Detects whether the current price has shifted more than 15% from the
   * oldest price in the rolling window.
   *
   * Returns shift details if threshold exceeded, null otherwise.
   */
  private detectShift(
    key: WindowKey,
    currentPrice: number,
  ): { oldPrice: number; percentChange: number } | null {
    const window = this.windows.get(key);
    if (!window || window.length < 2) return null;

    const oldestTick = window[0];
    const oldPrice = oldestTick.price;

    // Avoid division by zero
    if (oldPrice === 0) return null;

    const percentChange = (currentPrice - oldPrice) / oldPrice;

    if (Math.abs(percentChange) > SHIFT_THRESHOLD) {
      return { oldPrice, percentChange };
    }

    return null;
  }

  /**
   * Creates a composite key for the rolling window map.
   */
  private makeKey(fixtureId: string, market: string, outcome: string): WindowKey {
    return `${fixtureId}::${market}::${outcome}`;
  }

  /**
   * Persists the odds tick to the odds_ticks table.
   * Non-blocking: logs errors but does not throw.
   */
  private async storeOddsTick(
    fixtureId: string,
    timestamp: number,
    market: string,
    prices: Record<string, number>,
  ): Promise<void> {
    const supabase = getSupabaseClient();

    const record: OddsTicksInsert = {
      fixture_id: Number(fixtureId),
      ts: timestamp,
      market,
      price_json: prices as unknown as Record<string, unknown>,
    };

    const { error } = await supabase.from('odds_ticks').insert(record);

    if (error) {
      console.error('[odds-tracker] Failed to store odds tick:', error.message);
    }
  }

  // ─── Testing Helpers ─────────────────────────────────────────────────────

  /**
   * Resets all rolling windows. Useful for testing.
   */
  reset(): void {
    this.windows.clear();
  }

  /**
   * Returns the current window for a given key. Useful for testing.
   */
  getWindow(fixtureId: string, market: string, outcome: string): PriceTick[] | undefined {
    return this.windows.get(this.makeKey(fixtureId, market, outcome));
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

export const oddsTracker = new OddsTracker();

// ─── Difficulty Multiplier (Requirements 8.4, 17.1–17.4) ────────────────────

/** Difficulty multiplier is capped at this value regardless of how long the odds are. */
const MAX_DIFFICULTY_MULTIPLIER = 5.0;

/** Neutral fallback when no odds data exists yet for a fixture (e.g. pre-kickoff). */
const DEFAULT_DIFFICULTY_MULTIPLIER = 1.0;

/**
 * Computes the odds-derived difficulty multiplier for a Read prompt being
 * surfaced right now: `min(1.0 / probability, 5.0)`. Decimal odds already
 * equal `1 / probability`, so this collapses to `min(price, 5.0)`.
 *
 * The Read prompts Keeper generates are contextual Yes/No questions (see
 * keeper/contextual.ts), not tied to one fixed market outcome — so rather
 * than picking one arbitrary side's price, this uses the *longest* (least
 * likely) outcome price from the fixture's most recent odds tick as a proxy
 * for "how surprising is the situation right now." A fixture with tight,
 * near-even odds gets a low multiplier; a fixture with a heavy favorite
 * (long odds on the underdog) gets a high one — matching the intent of
 * "bold calls in unlikely moments earn more Standing."
 *
 * Returns DEFAULT_DIFFICULTY_MULTIPLIER (1.0, neutral) if no odds tick
 * exists yet for the fixture — this is expected right after kickoff before
 * the odds stream has produced its first tick, not an error condition.
 */
export async function getLatestDifficultyMultiplier(fixtureId: string): Promise<number> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('odds_ticks')
    .select('price_json')
    .eq('fixture_id', Number(fixtureId))
    .order('ts', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[odds-tracker] getLatestDifficultyMultiplier query error:', error.message);
    return DEFAULT_DIFFICULTY_MULTIPLIER;
  }

  if (!data) {
    return DEFAULT_DIFFICULTY_MULTIPLIER;
  }

  const prices = data.price_json as Record<string, unknown>;
  const values = Object.values(prices).filter(
    (p): p is number => typeof p === 'number' && p > 0,
  );

  if (values.length === 0) {
    return DEFAULT_DIFFICULTY_MULTIPLIER;
  }

  const longestOdds = Math.max(...values);
  return Math.min(longestOdds, MAX_DIFFICULTY_MULTIPLIER);
}

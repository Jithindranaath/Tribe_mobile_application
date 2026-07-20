/**
 * TxLINE odds_ticks helpers.
 *
 * Odds ingestion, shift detection (60s rolling window, 15% threshold), and
 * ODDS_SHIFT_EVENT emission all actually live in streams.ts's handleOddsData
 * — this file previously duplicated that logic in an OddsTracker class that
 * was never instantiated anywhere (removed; see git history if it's ever
 * needed again). What remains here is the one thing that isn't duplicated
 * elsewhere: reading odds_ticks back out for the Read difficulty multiplier.
 *
 * Requirements: 8.4, 17.1–17.4
 */

import { getSupabaseClient } from '../lib/supabase.js';

// ─── Difficulty Multiplier ───────────────────────────────────────────────────

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

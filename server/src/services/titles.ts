/**
 * Title System — checks and grants fan titles based on Read performance.
 *
 * Title grants are recorded on-chain (FanAccount.titles bitmask, via the
 * `grant_title` instruction) so they survive server restarts and are the
 * real source of truth. The in-memory `grantedTitles` map below is kept as a
 * same-process fast-path cache to avoid a redundant on-chain grant attempt
 * within one process's lifetime — `cached_titles` (fans table) is the
 * cross-process/cross-restart cache conviction.ts actually reads from.
 *
 * Seer title: granted when reads_correct / reads_total > 0.75 AND reads_total >= 20
 *
 * Requirements: 16.1, 16.2
 */

import { getSupabaseClient } from '../lib/supabase.js';
import { getFanById } from './fans.js';
import { grantTitleOnChain } from './onchain.js';
import { setCachedFanTitles } from './standing-cache.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Bitmask value for the Seer title (bit 0) */
export const SEER_BITMASK = 0x01;

/** Minimum accuracy ratio required for Seer title (strictly greater than) */
export const SEER_ACCURACY_THRESHOLD = 0.75;

/** Minimum total resolved reads required for Seer title */
export const SEER_MIN_READS = 20;

// ─── In-Memory Title Store ───────────────────────────────────────────────────

/**
 * In-memory store of granted titles per fan.
 * Key: fanId, Value: bitmask of granted titles.
 *
 * For hackathon use. Production will use on-chain FanAccount.titles bitmask.
 */
const grantedTitles: Map<string, number> = new Map();

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Pure check: does this fan qualify for the Seer title based on their read stats?
 *
 * Queries reads_live for the fan's total resolved reads and correct reads.
 * Returns true if correct / total > 0.75 AND total >= 20.
 */
export async function checkSeerTitle(fanId: string): Promise<boolean> {
  const supabase = getSupabaseClient();

  // Count total resolved reads for this fan
  const { count: totalCount, error: totalError } = await supabase
    .from('reads_live')
    .select('*', { count: 'exact', head: true })
    .eq('fan_id', fanId)
    .in('status', ['resolved', 'settled']);

  if (totalError || totalCount === null) {
    console.error('[Titles] Error querying total reads:', totalError?.message);
    return false;
  }

  if (totalCount < SEER_MIN_READS) {
    return false;
  }

  // Count correct reads (standing_delta > 0 indicates correct resolution)
  const { count: correctCount, error: correctError } = await supabase
    .from('reads_live')
    .select('*', { count: 'exact', head: true })
    .eq('fan_id', fanId)
    .in('status', ['resolved', 'settled'])
    .gt('standing_delta', 0);

  if (correctError || correctCount === null) {
    console.error('[Titles] Error querying correct reads:', correctError?.message);
    return false;
  }

  const accuracy = correctCount / totalCount;
  return accuracy > SEER_ACCURACY_THRESHOLD;
}

/**
 * Grants the Seer title to a fan: calls the on-chain `grant_title`
 * instruction (source of truth), updates `cached_titles` (fans table, so
 * conviction.ts's weight multiplier sees it without an RPC call), and
 * updates the in-memory same-process cache.
 *
 * Looks up the fan's wallet address via `getFanById` — grant_title needs it
 * to derive the FanAccount PDA, same as settleReadOnChain does.
 */
export async function grantSeerTitle(fanId: string): Promise<void> {
  const fan = await getFanById(fanId);
  if (!fan) {
    console.error(`[Titles] Cannot grant Seer title — fan ${fanId} not found`);
    return;
  }

  try {
    await grantTitleOnChain(fan.wallet_pubkey, SEER_BITMASK);
  } catch (err) {
    console.error(
      `[Titles] On-chain grant_title failed for fan ${fanId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return; // don't update caches if the on-chain write didn't actually happen
  }

  const current = grantedTitles.get(fanId) ?? 0;
  const updated = current | SEER_BITMASK;
  grantedTitles.set(fanId, updated);
  await setCachedFanTitles(fanId, updated);

  console.log(`[Titles] Granted Seer title to fan ${fanId} (on-chain + cached)`);
}

/**
 * Checks if a fan already has the Seer title granted.
 */
export function hasSeerTitle(fanId: string): boolean {
  const titles = grantedTitles.get(fanId) ?? 0;
  return (titles & SEER_BITMASK) !== 0;
}

/**
 * Gets the full title bitmask for a fan.
 * Returns 0 if no titles have been granted.
 */
export function getTitleBitmask(fanId: string): number {
  return grantedTitles.get(fanId) ?? 0;
}

/**
 * Hook to be called after each FanAccount settlement.
 * Checks Seer eligibility and grants if qualified and not already granted.
 *
 * @param fanId - The fan to check after settlement
 * @returns true if the Seer title was newly granted in this call
 */
export async function checkAndGrantSeerTitle(fanId: string): Promise<boolean> {
  if (hasSeerTitle(fanId)) {
    return false;
  }

  const qualifies = await checkSeerTitle(fanId);
  if (!qualifies) {
    return false;
  }

  await grantSeerTitle(fanId);
  return true;
}

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Resets the in-memory title store. For testing only.
 */
export function _resetTitleStore(): void {
  grantedTitles.clear();
}

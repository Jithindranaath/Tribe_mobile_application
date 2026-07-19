/**
 * Off-chain cache of on-chain Standing values.
 *
 * Standing (FanAccount.standing, TribeAccount.aggregate_standing) only ever
 * changes through code we control (fan/tribe creation, settle_read) — so
 * instead of fetching live on-chain data on every read (too slow for the
 * <1s conviction-signal requirement), this cache is updated in the same code
 * path as each on-chain write, giving zero-staleness reads at zero extra RPC
 * cost. The tribe rank cron (services/rank.ts wiring in index.ts) already
 * re-fetches every tribe's real on-chain aggregate_standing every 60s for its
 * own purposes — it also overwrites this cache, as a lightweight safety net
 * against drift (e.g. a settlement that touched the chain but failed to
 * update the cache for some reason).
 */

import { getSupabaseClient } from '../lib/supabase.js';

// ─── Fan standing ──────────────────────────────────────────────────────────

export async function getCachedFanStanding(fanId: string): Promise<number> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('fans')
    .select('cached_standing')
    .eq('fan_id', fanId)
    .maybeSingle();

  return typeof data?.cached_standing === 'number' ? data.cached_standing : 100;
}

export async function setCachedFanStanding(fanId: string, standing: number): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('fans').update({ cached_standing: standing }).eq('fan_id', fanId);
  if (error) {
    console.error('[standing-cache] Failed to set fan cached_standing:', error.message);
  }
}

/** Read-then-write increment. Not atomic under concurrent writes to the same
 * fan — acceptable at hackathon scale (settlement batches are processed
 * sequentially); would need a Postgres RPC for strict correctness at load. */
export async function bumpCachedFanStanding(fanId: string, delta: number): Promise<void> {
  const current = await getCachedFanStanding(fanId);
  await setCachedFanStanding(fanId, current + delta);
}

// ─── Tribe aggregate standing ──────────────────────────────────────────────

export async function getCachedTribeAggregateStanding(tribeId: string): Promise<number> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('tribes_live')
    .select('aggregate_standing')
    .eq('tribe_id', tribeId)
    .maybeSingle();

  return typeof data?.aggregate_standing === 'number' ? data.aggregate_standing : 0;
}

export async function setCachedTribeAggregateStanding(tribeId: string, aggregateStanding: number): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('tribes_live')
    .upsert({ tribe_id: tribeId, aggregate_standing: aggregateStanding, last_updated: new Date().toISOString() }, { onConflict: 'tribe_id' });
  if (error) {
    console.error('[standing-cache] Failed to set tribe aggregate_standing:', error.message);
  }
}

export async function bumpCachedTribeAggregateStanding(tribeId: string, delta: number): Promise<void> {
  const current = await getCachedTribeAggregateStanding(tribeId);
  await setCachedTribeAggregateStanding(tribeId, current + delta);
}

// ─── Fan titles ────────────────────────────────────────────────────────────
//
// Same pattern as fan standing above, for FanAccount.titles (see migration
// 004_fan_titles.sql). Exists so conviction.ts's Seer weight multiplier can
// read a fan's titles without a live on-chain RPC call on the hot conviction
// path — titles.ts's grant flow updates this cache in the same step as the
// on-chain grant_title write.

export async function getCachedFanTitles(fanId: string): Promise<number> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('fans')
    .select('cached_titles')
    .eq('fan_id', fanId)
    .maybeSingle();

  return typeof data?.cached_titles === 'number' ? data.cached_titles : 0;
}

export async function setCachedFanTitles(fanId: string, titles: number): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('fans').update({ cached_titles: titles }).eq('fan_id', fanId);
  if (error) {
    console.error('[standing-cache] Failed to set fan cached_titles:', error.message);
  }
}

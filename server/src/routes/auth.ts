/**
 * Auth routes — fan registration after Privy authentication.
 *
 * POST /api/auth/register creates (or fetches, if already registered) the
 * fan's on-chain identity: a TribeAccount (created once per tribe) and a
 * FanAccount (created once per wallet), then persists the
 * social_identity -> wallet_pubkey mapping off-chain in the `fans` table.
 */

import { Router, type Request, type Response } from 'express';
import { getSupabaseClient } from '../lib/supabase.js';
import { getOrCreateTribeAccount, getOrCreateFanAccount } from '../services/onchain.js';
import { setCachedFanStanding, bumpCachedTribeAggregateStanding } from '../services/standing-cache.js';
import type { FansInsert, FansRow } from '../db/schema.js';

const router = Router();

interface RegisterRequestBody {
  privyUserId: string;
  tribeId: string;
  tribeName: string;
  macroTribe: string;
  walletAddress: string;
}

interface FanProfileResponse {
  fanId: string;
  privyUserId: string;
  tribeId: string;
  tribeName: string;
  macroTribe: string;
  standing: number;
  titles: number;
  readsCorrect: number;
  readsTotal: number;
  currentStreak: number;
}

router.post('/register', async (req: Request, res: Response) => {
  const { privyUserId, tribeId, tribeName, macroTribe, walletAddress } =
    req.body as Partial<RegisterRequestBody>;

  if (!privyUserId || !tribeId || !tribeName || !macroTribe || !walletAddress) {
    return res.status(400).json({
      error:
        'Missing required fields: privyUserId, tribeId, tribeName, macroTribe, walletAddress',
    });
  }

  const supabase = getSupabaseClient();

  try {
    // Idempotent: a fan who already registered just gets their current profile back.
    const { data: existingFan } = await supabase
      .from('fans')
      .select('*')
      .eq('privy_user_id', privyUserId)
      .maybeSingle<FansRow>();

    if (existingFan) {
      const tribe = await getOrCreateTribeAccount(existingFan.tribe_id, existingFan.macro_tribe);
      const fanOnchain = await getOrCreateFanAccount(existingFan.wallet_pubkey, tribe.pda);

      // Reconcile the cache to the fresh on-chain value on every re-registration
      // (e.g. app relaunch) — a free, low-frequency correctness check.
      await setCachedFanStanding(existingFan.fan_id, fanOnchain.standing);

      return res.json(toFanProfile(existingFan, fanOnchain));
    }

    // New fan: get-or-create the tribe, then the fan account, on-chain.
    const tribe = await getOrCreateTribeAccount(tribeId, macroTribe);
    const fanOnchain = await getOrCreateFanAccount(walletAddress, tribe.pda);

    const insertPayload: FansInsert = {
      privy_user_id: privyUserId,
      wallet_pubkey: walletAddress,
      tribe_id: tribeId,
      tribe_name: tribeName,
      macro_tribe: macroTribe,
      cached_standing: fanOnchain.standing,
    };

    const { data: inserted, error } = await supabase
      .from('fans')
      .insert(insertPayload)
      .select()
      .single<FansRow>();

    if (error || !inserted) {
      console.error('[auth] Failed to persist fan record:', error?.message);
      return res.status(500).json({ error: 'Failed to persist fan record' });
    }

    // A newly-created FanAccount also bumped aggregate_standing on-chain (see
    // create_fan_account) — mirror that into the cache. Idempotent
    // re-registrations (the branch above) must NOT double-count this.
    if (fanOnchain.isNew) {
      await bumpCachedTribeAggregateStanding(tribeId, fanOnchain.standing);
    }

    return res.status(201).json(toFanProfile(inserted, fanOnchain));
  } catch (err) {
    console.error('[auth] Registration failed:', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ error: 'Registration failed' });
  }
});

function toFanProfile(
  fan: FansRow,
  onchain: { standing: number; titles: number; readsCorrect: number; readsTotal: number },
): FanProfileResponse {
  return {
    fanId: fan.fan_id,
    privyUserId: fan.privy_user_id,
    tribeId: fan.tribe_id,
    tribeName: fan.tribe_name,
    macroTribe: fan.macro_tribe,
    standing: onchain.standing,
    titles: onchain.titles,
    readsCorrect: onchain.readsCorrect,
    readsTotal: onchain.readsTotal,
    currentStreak: 0,
  };
}

export default router;

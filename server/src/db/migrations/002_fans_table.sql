-- TRIBE Platform: Fan Identity Table
-- Migration 002: social_identity -> wallet_pubkey mapping for registered fans
--
-- Needed by POST /api/auth/register: canonical source of fan_id used throughout
-- reads_live.fan_id, timeline.fan_id, share_cards.fan_id.

CREATE TABLE IF NOT EXISTS fans (
  fan_id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  privy_user_id TEXT NOT NULL UNIQUE,
  wallet_pubkey TEXT NOT NULL UNIQUE,
  tribe_id TEXT NOT NULL,
  tribe_name TEXT NOT NULL,
  macro_tribe TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fans_privy_user_id ON fans(privy_user_id);
CREATE INDEX IF NOT EXISTS idx_fans_wallet_pubkey ON fans(wallet_pubkey);

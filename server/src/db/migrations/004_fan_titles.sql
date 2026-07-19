-- TRIBE Platform: Off-chain Titles Cache
-- Migration 004: event-driven cache of on-chain FanAccount.titles bitmask,
-- same pattern as 003_standing_cache.sql — updated in the same code path as
-- the on-chain grant_title write, so conviction.ts's Seer weight multiplier
-- can read it without a live on-chain RPC call on the hot conviction path.

ALTER TABLE fans ADD COLUMN IF NOT EXISTS cached_titles SMALLINT NOT NULL DEFAULT 0;

-- TRIBE Platform: Off-chain Standing Cache
-- Migration 003: event-driven cache of on-chain standing, updated in the same
-- code path as each on-chain write (registration, settlement), reconciled
-- opportunistically by the tribe rank cron.

ALTER TABLE fans ADD COLUMN IF NOT EXISTS cached_standing BIGINT NOT NULL DEFAULT 100;

ALTER TABLE tribes_live ADD COLUMN IF NOT EXISTS aggregate_standing BIGINT NOT NULL DEFAULT 0;

-- TRIBE Platform: Off-Chain State Tables
-- Migration 001: Initial schema for all Postgres tables
-- Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7

-- Live tribe state (ephemeral, for Campfire)
CREATE TABLE IF NOT EXISTS tribes_live (
  tribe_id TEXT PRIMARY KEY,
  live_presence INTEGER DEFAULT 0,
  conviction_signal JSONB,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Pending and recently resolved Reads
CREATE TABLE IF NOT EXISTS reads_live (
  read_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fan_id TEXT NOT NULL,
  fixture_id BIGINT NOT NULL,
  read_type TEXT NOT NULL,
  predicted SMALLINT NOT NULL,
  odds_at_commit DECIMAL(10,4),
  committed_at TIMESTAMPTZ DEFAULT NOW(),
  resolved SMALLINT,
  txline_seq BIGINT,
  status TEXT DEFAULT 'pending',
  standing_delta BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reads_live_fan ON reads_live(fan_id);
CREATE INDEX IF NOT EXISTS idx_reads_live_fixture_status ON reads_live(fixture_id, status);

-- Fan timeline (Legacy moments)
CREATE TABLE IF NOT EXISTS timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fan_id TEXT NOT NULL,
  moment_id TEXT NOT NULL,
  fixture_id BIGINT NOT NULL,
  type TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timeline_fan ON timeline(fan_id, created_at DESC);

-- TxLINE fixtures mirror
CREATE TABLE IF NOT EXISTS fixtures (
  fixture_id BIGINT PRIMARY KEY,
  sport TEXT NOT NULL,
  league TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  kickoff TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL,
  coverage BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- TxLINE match events (audit trail)
CREATE TABLE IF NOT EXISTS match_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id BIGINT NOT NULL,
  seq BIGINT NOT NULL,
  ts BIGINT NOT NULL,
  game_state TEXT NOT NULL,
  event_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_events_fixture_seq ON match_events(fixture_id, seq);

-- TxLINE odds ticks
CREATE TABLE IF NOT EXISTS odds_ticks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id BIGINT NOT NULL,
  ts BIGINT NOT NULL,
  market TEXT NOT NULL,
  price_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_odds_ticks_fixture_ts ON odds_ticks(fixture_id, ts DESC);

-- Share cards
CREATE TABLE IF NOT EXISTS share_cards (
  card_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fan_id TEXT NOT NULL,
  fixture_id BIGINT NOT NULL,
  template TEXT NOT NULL,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_cards_fan ON share_cards(fan_id, created_at DESC);

/**
 * TypeScript types matching the off-chain Postgres tables.
 * Used for type-safe queries against Supabase.
 *
 * Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */

// ---------------------------------------------------------------------------
// tribes_live — Ephemeral live tribe state for Campfire
// ---------------------------------------------------------------------------

export interface TribesLiveRow {
  tribe_id: string;
  live_presence: number;
  conviction_signal: Record<string, unknown> | null;
  /** Off-chain cache of TribeAccount.aggregate_standing — see services/onchain.ts. */
  aggregate_standing: number;
  last_updated: string; // ISO 8601 timestamptz
}

export type TribesLiveInsert = Pick<TribesLiveRow, 'tribe_id'> &
  Partial<Omit<TribesLiveRow, 'tribe_id'>>;

export type TribesLiveUpdate = Partial<Omit<TribesLiveRow, 'tribe_id'>>;

// ---------------------------------------------------------------------------
// reads_live — Pending and recently resolved Reads
// ---------------------------------------------------------------------------

export interface ReadsLiveRow {
  read_id: string; // UUID
  fan_id: string;
  fixture_id: number;
  read_type: string; // 'moment_read' | 'momentum_read' | 'instinct_read'
  predicted: number; // SMALLINT
  odds_at_commit: number | null; // DECIMAL(10,4)
  committed_at: string; // ISO 8601 timestamptz
  resolved: number | null; // SMALLINT
  txline_seq: number | null; // BIGINT
  status: string; // 'pending' | 'resolved' | 'settled'
  standing_delta: number | null; // BIGINT
  created_at: string; // ISO 8601 timestamptz
}

export type ReadsLiveInsert = Omit<ReadsLiveRow, 'read_id' | 'committed_at' | 'created_at'> &
  Partial<Pick<ReadsLiveRow, 'read_id' | 'committed_at' | 'created_at'>>;

export type ReadsLiveUpdate = Partial<
  Omit<ReadsLiveRow, 'read_id' | 'fan_id' | 'fixture_id' | 'created_at'>
>;

// ---------------------------------------------------------------------------
// timeline — Fan Legacy moments
// ---------------------------------------------------------------------------

export interface TimelineRow {
  id: string; // UUID
  fan_id: string;
  moment_id: string;
  fixture_id: number;
  type: string; // 'READ_SUCCESS' | 'TITLE_EARNED' | 'RANK_CLIMB'
  payload_json: Record<string, unknown>;
  created_at: string; // ISO 8601 timestamptz
}

export type TimelineInsert = Omit<TimelineRow, 'id' | 'created_at'> &
  Partial<Pick<TimelineRow, 'id' | 'created_at'>>;

// ---------------------------------------------------------------------------
// fixtures — TxLINE fixtures mirror
// ---------------------------------------------------------------------------

export interface FixturesRow {
  fixture_id: number; // BIGINT (primary key)
  sport: string;
  league: string;
  home_team: string;
  away_team: string;
  kickoff: string; // ISO 8601 timestamptz
  state: string; // 'scheduled' | 'live' | 'finished'
  coverage: boolean;
  created_at: string; // ISO 8601 timestamptz
}

export type FixturesInsert = Omit<FixturesRow, 'coverage' | 'created_at'> &
  Partial<Pick<FixturesRow, 'coverage' | 'created_at'>>;

export type FixturesUpdate = Partial<Omit<FixturesRow, 'fixture_id' | 'created_at'>>;

// ---------------------------------------------------------------------------
// match_events — TxLINE match events audit trail
// ---------------------------------------------------------------------------

export interface MatchEventsRow {
  id: string; // UUID
  fixture_id: number;
  seq: number; // BIGINT
  ts: number; // BIGINT (TxLINE timestamp)
  game_state: string;
  event_json: Record<string, unknown>;
  created_at: string; // ISO 8601 timestamptz
}

export type MatchEventsInsert = Omit<MatchEventsRow, 'id' | 'created_at'> &
  Partial<Pick<MatchEventsRow, 'id' | 'created_at'>>;

// ---------------------------------------------------------------------------
// odds_ticks — TxLINE odds ticks
// ---------------------------------------------------------------------------

export interface OddsTicksRow {
  id: string; // UUID
  fixture_id: number;
  ts: number; // BIGINT
  market: string; // e.g. 'match_winner', 'next_goal'
  price_json: Record<string, unknown>; // { home: 2.10, away: 3.50, draw: 3.20 }
  created_at: string; // ISO 8601 timestamptz
}

export type OddsTicksInsert = Omit<OddsTicksRow, 'id' | 'created_at'> &
  Partial<Pick<OddsTicksRow, 'id' | 'created_at'>>;

// ---------------------------------------------------------------------------
// share_cards — Generated share card images
// ---------------------------------------------------------------------------

export interface ShareCardsRow {
  card_id: string; // UUID
  fan_id: string;
  fixture_id: number;
  template: string; // 'read_success' | 'title_earned'
  image_url: string;
  created_at: string; // ISO 8601 timestamptz
}

export type ShareCardsInsert = Omit<ShareCardsRow, 'card_id' | 'created_at'> &
  Partial<Pick<ShareCardsRow, 'card_id' | 'created_at'>>;

// ---------------------------------------------------------------------------
// fans — social_identity -> wallet_pubkey mapping (registered fans)
// ---------------------------------------------------------------------------

export interface FansRow {
  fan_id: string;
  privy_user_id: string;
  wallet_pubkey: string;
  tribe_id: string;
  tribe_name: string;
  macro_tribe: string;
  /** Off-chain cache of FanAccount.standing — see services/onchain.ts. */
  cached_standing: number;
  created_at: string; // ISO 8601 timestamptz
}

export type FansInsert = Omit<FansRow, 'fan_id' | 'created_at' | 'cached_standing'> &
  Partial<Pick<FansRow, 'fan_id' | 'created_at' | 'cached_standing'>>;

export type FansUpdate = Partial<Omit<FansRow, 'fan_id' | 'created_at'>>;

// ---------------------------------------------------------------------------
// Supabase Database type helper (for createClient<Database> generic)
// ---------------------------------------------------------------------------

export interface Database {
  public: {
    Tables: {
      fans: {
        Row: FansRow;
        Insert: FansInsert;
        Update: FansUpdate;
      };
      tribes_live: {
        Row: TribesLiveRow;
        Insert: TribesLiveInsert;
        Update: TribesLiveUpdate;
      };
      reads_live: {
        Row: ReadsLiveRow;
        Insert: ReadsLiveInsert;
        Update: ReadsLiveUpdate;
      };
      timeline: {
        Row: TimelineRow;
        Insert: TimelineInsert;
        Update: never;
      };
      fixtures: {
        Row: FixturesRow;
        Insert: FixturesInsert;
        Update: FixturesUpdate;
      };
      match_events: {
        Row: MatchEventsRow;
        Insert: MatchEventsInsert;
        Update: never;
      };
      odds_ticks: {
        Row: OddsTicksRow;
        Insert: OddsTicksInsert;
        Update: never;
      };
      share_cards: {
        Row: ShareCardsRow;
        Insert: ShareCardsInsert;
        Update: never;
      };
    };
  };
}

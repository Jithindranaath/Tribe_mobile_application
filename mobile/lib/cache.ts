/**
 * TRIBE Mobile App — expo-sqlite cache layer for offline resilience
 *
 * Provides write-through caching (persist on successful fetch) and
 * read-from-cache (serve stale data when offline) using expo-sqlite.
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4
 */

import * as SQLite from 'expo-sqlite';
import type { Fixture, TribeRanking, TimelineMoment } from '../types';

// ─── Database Instance ───────────────────────────────────────────────────────

let db: SQLite.SQLiteDatabase | null = null;

/**
 * Returns the database instance, opening it if necessary.
 */
function getDatabase(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync('tribe_cache.db');
  }
  return db;
}

// ─── Campfire Snapshot Type ──────────────────────────────────────────────────

export interface CampfireSnapshot {
  fixtureId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  minute: number | null;
  presenceCount: number | null;
  lastSurgeMessage: string | null;
  updatedAt: number;
}

// ─── Schema Initialization ───────────────────────────────────────────────────

/**
 * Creates all cache tables if they don't already exist.
 * Call this on app startup before any cache reads/writes.
 */
export function initDatabase(): void {
  const database = getDatabase();

  database.execSync(`
    CREATE TABLE IF NOT EXISTS fixtures (
      fixture_id INTEGER PRIMARY KEY,
      sport TEXT NOT NULL,
      league TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      kickoff TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'scheduled',
      cached_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);

  database.execSync(`
    CREATE TABLE IF NOT EXISTS tribe_standings (
      tribe_id TEXT PRIMARY KEY,
      tribe_name TEXT NOT NULL,
      aggregate_standing INTEGER NOT NULL,
      member_count INTEGER NOT NULL,
      accuracy_pct REAL NOT NULL,
      rank INTEGER NOT NULL,
      view_type TEXT NOT NULL,
      cached_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);

  database.execSync(`
    CREATE TABLE IF NOT EXISTS moments (
      id TEXT PRIMARY KEY,
      fan_id TEXT NOT NULL,
      fixture_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      match_label TEXT NOT NULL,
      prediction TEXT NOT NULL,
      outcome TEXT NOT NULL,
      created_at TEXT NOT NULL,
      cached_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);

  database.execSync(`
    CREATE TABLE IF NOT EXISTS campfire_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      fixture_id TEXT,
      home_score INTEGER,
      away_score INTEGER,
      minute INTEGER,
      presence_count INTEGER,
      last_surge_message TEXT,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);

  database.execSync(`
    CREATE TABLE IF NOT EXISTS committed_reads (
      read_id TEXT PRIMARY KEY,
      predicted INTEGER NOT NULL,
      committed_at INTEGER NOT NULL
    );
  `);
}

// ─── Fixtures Cache ──────────────────────────────────────────────────────────

/**
 * Write-through cache: persists fixtures to SQLite after a successful REST fetch.
 */
export function cacheFixtures(fixtures: Fixture[]): void {
  const database = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  for (const fixture of fixtures) {
    database.runSync(
      `INSERT OR REPLACE INTO fixtures (fixture_id, sport, league, home_team, away_team, kickoff, state, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fixture.fixtureId,
        fixture.sport,
        fixture.league,
        fixture.homeTeam,
        fixture.awayTeam,
        fixture.kickoff,
        fixture.state,
        now,
      ],
    );
  }
}

/**
 * Read from cache: returns cached fixtures when network is unavailable.
 */
export function getCachedFixtures(): Fixture[] {
  const database = getDatabase();
  const rows = database.getAllSync(
    'SELECT fixture_id, sport, league, home_team, away_team, kickoff, state FROM fixtures ORDER BY kickoff ASC',
  );

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    fixtureId: row.fixture_id as number,
    sport: row.sport as string,
    league: row.league as string,
    homeTeam: row.home_team as string,
    awayTeam: row.away_team as string,
    kickoff: row.kickoff as string,
    state: row.state as 'scheduled' | 'live' | 'finished',
  }));
}

// ─── Standings Cache ─────────────────────────────────────────────────────────

/**
 * Write-through cache: persists tribe standings after a successful fetch.
 */
export function cacheStandings(standings: TribeRanking[], viewType: string): void {
  const database = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  // Clear old entries for this view type before inserting fresh data
  database.runSync('DELETE FROM tribe_standings WHERE view_type = ?', [viewType]);

  for (const standing of standings) {
    database.runSync(
      `INSERT OR REPLACE INTO tribe_standings (tribe_id, tribe_name, aggregate_standing, member_count, accuracy_pct, rank, view_type, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        standing.tribeId,
        standing.tribeName,
        standing.aggregateStanding,
        standing.memberCount,
        standing.accuracyPercentage,
        standing.rank,
        viewType,
        now,
      ],
    );
  }
}

/**
 * Read from cache: returns cached standings for the given view type.
 */
export function getCachedStandings(viewType: string): TribeRanking[] {
  const database = getDatabase();
  const rows = database.getAllSync(
    'SELECT tribe_id, tribe_name, aggregate_standing, member_count, accuracy_pct, rank FROM tribe_standings WHERE view_type = ? ORDER BY rank ASC',
    [viewType],
  );

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    tribeId: row.tribe_id as string,
    tribeName: row.tribe_name as string,
    aggregateStanding: row.aggregate_standing as number,
    memberCount: row.member_count as number,
    accuracyPercentage: row.accuracy_pct as number,
    rank: row.rank as number,
  }));
}

// ─── Moments Cache ───────────────────────────────────────────────────────────

/**
 * Write-through cache: persists fan timeline moments after a successful fetch.
 */
export function cacheMoments(moments: TimelineMoment[]): void {
  const database = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  for (const moment of moments) {
    database.runSync(
      `INSERT OR REPLACE INTO moments (id, fan_id, fixture_id, type, match_label, prediction, outcome, created_at, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        moment.id,
        moment.fanId,
        moment.fixtureId,
        moment.type,
        moment.match,
        moment.prediction,
        moment.outcome,
        moment.createdAt,
        now,
      ],
    );
  }
}

/**
 * Read from cache: returns cached moments for the given fan.
 */
export function getCachedMoments(fanId: string): TimelineMoment[] {
  const database = getDatabase();
  const rows = database.getAllSync(
    'SELECT id, fan_id, fixture_id, type, match_label, prediction, outcome, created_at FROM moments WHERE fan_id = ? ORDER BY created_at DESC',
    [fanId],
  );

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    fanId: row.fan_id as string,
    fixtureId: row.fixture_id as number,
    type: row.type as 'READ_SUCCESS' | 'TITLE_EARNED' | 'RANK_CLIMB',
    match: row.match_label as string,
    prediction: row.prediction as string,
    outcome: row.outcome as string,
    createdAt: row.created_at as string,
  }));
}

// ─── Campfire Snapshot Cache ─────────────────────────────────────────────────

/**
 * Saves the latest Campfire state snapshot (single row, always id=1).
 * Used for immediate context on screen re-entry (Requirement 13.4).
 */
export function saveCampfireSnapshot(snapshot: Omit<CampfireSnapshot, 'updatedAt'>): void {
  const database = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  database.runSync(
    `INSERT OR REPLACE INTO campfire_snapshot (id, fixture_id, home_score, away_score, minute, presence_count, last_surge_message, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshot.fixtureId ?? null,
      snapshot.homeScore ?? null,
      snapshot.awayScore ?? null,
      snapshot.minute ?? null,
      snapshot.presenceCount ?? null,
      snapshot.lastSurgeMessage ?? null,
      now,
    ],
  );
}

/**
 * Retrieves the last saved Campfire state for quick screen re-entry.
 */
export function getCampfireSnapshot(): CampfireSnapshot | null {
  const database = getDatabase();
  const rows = database.getAllSync(
    'SELECT fixture_id, home_score, away_score, minute, presence_count, last_surge_message, updated_at FROM campfire_snapshot WHERE id = 1',
  );

  if (!rows || rows.length === 0) {
    return null;
  }

  const row = rows[0] as Record<string, unknown>;
  return {
    fixtureId: (row.fixture_id as string) ?? null,
    homeScore: (row.home_score as number) ?? null,
    awayScore: (row.away_score as number) ?? null,
    minute: (row.minute as number) ?? null,
    presenceCount: (row.presence_count as number) ?? null,
    lastSurgeMessage: (row.last_surge_message as string) ?? null,
    updatedAt: row.updated_at as number,
  };
}

// ─── Committed Reads Cache ───────────────────────────────────────────────────

/**
 * Persists a committed read for dedup across sessions.
 */
export function saveCommittedRead(readId: string, predicted: number): void {
  const database = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  database.runSync(
    'INSERT OR REPLACE INTO committed_reads (read_id, predicted, committed_at) VALUES (?, ?, ?)',
    [readId, predicted, now],
  );
}

/**
 * Retrieves all committed read IDs for dedup on session restore.
 */
export function getCommittedReads(): Array<{ readId: string; predicted: number; committedAt: number }> {
  const database = getDatabase();
  const rows = database.getAllSync(
    'SELECT read_id, predicted, committed_at FROM committed_reads ORDER BY committed_at DESC',
  );

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    readId: row.read_id as string,
    predicted: row.predicted as number,
    committedAt: row.committed_at as number,
  }));
}

// ─── Cache Metadata Helpers ──────────────────────────────────────────────────

/**
 * Returns the age (in seconds) of the most recently cached fixture.
 * Useful for determining whether to show a "stale data" indicator.
 */
export function getFixturesCacheAge(): number | null {
  const database = getDatabase();
  const rows = database.getAllSync(
    'SELECT MAX(cached_at) as last_cached FROM fixtures',
  );

  if (!rows || rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;
  const lastCached = row.last_cached as number | null;
  if (lastCached === null) return null;

  return Math.floor(Date.now() / 1000) - lastCached;
}

/**
 * Returns the age (in seconds) of the standings cache for a given view type.
 */
export function getStandingsCacheAge(viewType: string): number | null {
  const database = getDatabase();
  const rows = database.getAllSync(
    'SELECT MAX(cached_at) as last_cached FROM tribe_standings WHERE view_type = ?',
    [viewType],
  );

  if (!rows || rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;
  const lastCached = row.last_cached as number | null;
  if (lastCached === null) return null;

  return Math.floor(Date.now() / 1000) - lastCached;
}

/**
 * Determines if cached data should be considered stale.
 * Data older than the given threshold (in seconds) is considered stale.
 * Default threshold: 5 minutes (300 seconds).
 */
export function isCacheStale(cacheAgeSeconds: number | null, thresholdSeconds: number = 300): boolean {
  if (cacheAgeSeconds === null) return true;
  return cacheAgeSeconds > thresholdSeconds;
}

// ─── Cache Cleanup ───────────────────────────────────────────────────────────

/**
 * Clears all cached data. Useful for logout or debugging.
 */
export function clearAllCaches(): void {
  const database = getDatabase();
  database.execSync('DELETE FROM fixtures');
  database.execSync('DELETE FROM tribe_standings');
  database.execSync('DELETE FROM moments');
  database.execSync('DELETE FROM campfire_snapshot');
  database.execSync('DELETE FROM committed_reads');
}

/**
 * TxLINE Replay Mode Manager.
 *
 * When no covered fixture is currently live, the system enters Replay Mode
 * to demonstrate full functionality using real historical data from TxLINE.
 *
 * Responsibilities:
 *   1. Poll fixture availability every 5 minutes
 *   2. Detect when no covered fixture is live → enter Replay Mode
 *   3. Select a recently-finished fixture (2 weeks to 6 hours post-kickoff)
 *   4. Fetch historical match data via GET /api/scores/historical/{fixtureId}
 *   5. Stream events through the same internal event bus at real or accelerated cadence
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import { getEnvConfig } from '../config/env.js';
import { TxLINEActivation } from './activation.js';
import { normalizeScoreEvent, type TxLINERawScoreEvent } from './normalizer.js';
import type { FixturesRow } from '../db/schema.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default polling interval: 5 minutes (300,000 ms) */
const DEFAULT_POLL_INTERVAL_MS = 300_000;

/** Minimum age of a fixture to qualify for replay: 6 hours in ms */
const MIN_FIXTURE_AGE_MS = 6 * 60 * 60 * 1000;

/** Maximum age of a fixture to qualify for replay: 14 days in ms */
const MAX_FIXTURE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** World Cup league identifiers (prioritized for selection) */
const WORLD_CUP_LEAGUES = ['FIFA World Cup', 'World Cup', 'FIFA WC'];

/** High-profile team names (used for tiebreaking) */
const HIGH_PROFILE_TEAMS = [
  'Brazil', 'Argentina', 'France', 'Germany', 'Spain',
  'England', 'Italy', 'Netherlands', 'Portugal', 'Belgium',
];

/** StatusId values indicating the match is actually in play (soccer-feed.mdx phase encoding). */
const MATCH_START_STATUS_IDS = new Set([2, 7]); // H1, ET1 — the two ways a match can "start"
/** StatusId values indicating the match has reached a final outcome. */
const MATCH_END_STATUS_IDS = new Set([5, 10, 13, 100]); // F, FET, FPE, game_finalised

/**
 * TxLINE's competitionId for the FIFA World Cup, per the vendored free-tier
 * example script (`tx-on-chain/examples/devnet/scripts/subscription_free_tier.ts`).
 * Not documented anywhere as a named constant — inferred from that script being
 * explicitly titled "Demo subscription and data access for free tier (World Cup)".
 */
const WORLD_CUP_COMPETITION_ID = 72;

/**
 * A football match's real-world duration (kickoff to final whistle) tops out
 * around 120 minutes (90 + extra time) plus stoppage/penalties/broadcast lag.
 * `/fixtures/snapshot` only documents GameState 1 (scheduled) and 6 (cancelled)
 * — there's no documented "live"/"finished" value — so live/finished is
 * inferred from StartTime vs now instead, using this as the upper bound for
 * "still plausibly live".
 */
const ASSUMED_MAX_MATCH_DURATION_MS = 3 * 60 * 60 * 1000; // 3 hours

/**
 * `/fixtures/snapshot` doesn't document its `startEpochDay` windowing, but
 * on-chain fixture roots are bucketed into 10-day windows keyed the same way
 * (see `fixture_validation_view_only.ts`'s `windowStartDay = floor(epochDay/10)*10`
 * for PDA derivation) — the off-chain snapshot almost certainly follows the
 * same bucketing. Querying the current and previous window covers the full
 * MAX_FIXTURE_AGE_MS (14-day) replay-candidate lookback with two calls.
 */
const SNAPSHOT_WINDOW_DAYS = 10;

/**
 * Trims a raw historical event log to the actual match window (kickoff to
 * final whistle). The raw historical feed includes hours of pre-match
 * coverage setup and post-match idle/disconnect events — a real fixture's
 * log can span 80+ hours even though the match itself lasts ~90-140 minutes.
 * Replaying the untrimmed log at real-time speed would take that entire
 * span; trimming to the actual match window is what makes "real-time replay"
 * mean "paced like the real match," not "paced like the raw log."
 *
 * Falls back to the full, untrimmed event list if no recognizable
 * start/end StatusId is found (e.g. synthetic test fixtures).
 */
export function trimToMatchWindow(events: TxLINERawScoreEvent[]): TxLINERawScoreEvent[] {
  const startTimes = events
    .filter((e) => e.StatusId !== undefined && MATCH_START_STATUS_IDS.has(e.StatusId))
    .map((e) => e.Ts ?? Infinity);
  const endTimes = events
    .filter((e) => e.StatusId !== undefined && MATCH_END_STATUS_IDS.has(e.StatusId))
    .map((e) => e.Ts ?? -Infinity);

  if (startTimes.length === 0 || endTimes.length === 0) {
    return events;
  }

  const startTs = Math.min(...startTimes);
  const endTs = Math.max(...endTimes);

  return events.filter((e) => e.Ts !== undefined && e.Ts >= startTs && e.Ts <= endTs);
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

/**
 * A fixture from the TxLINE fixtures API response.
 */
export interface TxLINEFixture {
  fixtureId: string;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string; // ISO 8601 timestamp
  state: string;   // 'scheduled' | 'live' | 'finished'
  coverage: boolean;
}

/**
 * Raw shape returned by `GET /fixtures/snapshot`, per the vendored
 * `fetching-snapshots.mdx` example and `fixture_validation_view_only.ts`'s
 * `validation.snapshot` fields. Only `GameState` values `1` (scheduled) and
 * `6` (cancelled) are documented — no live/finished value is documented, so
 * `mapRawFixtureSnapshot` infers those from `StartTime` instead.
 */
interface TxLINERawFixtureSnapshot {
  FixtureId: number;
  CompetitionId?: number;
  Competition?: string;
  Participant1: string;
  Participant2: string;
  Participant1IsHome: boolean;
  StartTime: number; // ms epoch
  GameState?: number;
  gameState?: number;
}

/**
 * Configuration options for the ReplayManager.
 */
export interface ReplayManagerOptions {
  /** Activation instance for auth headers */
  activation: TxLINEActivation;
  /** Playback speed multiplier (1 = real-time, 10 = 10x accelerated) */
  playbackSpeed?: number;
  /** Override for fixture polling interval (ms) */
  pollIntervalMs?: number;
  /** Override for fetching fixtures (useful for testing) */
  fetchFixtures?: () => Promise<TxLINEFixture[]>;
  /** Override for fetching historical data (useful for testing) */
  fetchHistoricalData?: (fixtureId: string) => Promise<TxLINERawScoreEvent[]>;
  /** Override for processing events (useful for testing) */
  processEvent?: (event: TxLINERawScoreEvent) => Promise<void>;
}

// ─── ReplayManager Class ─────────────────────────────────────────────────────

export class ReplayManager {
  private activation: TxLINEActivation;
  private playbackSpeed: number;
  private pollIntervalMs: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private streamTimeouts: ReturnType<typeof setTimeout>[] = [];
  private _isReplayActive = false;
  private _currentFixtureId: string | null = null;
  private _fetchFixtures: () => Promise<TxLINEFixture[]>;
  private _fetchHistoricalData: (fixtureId: string) => Promise<TxLINERawScoreEvent[]>;
  private _processEvent: (event: TxLINERawScoreEvent) => Promise<void>;

  constructor(options: ReplayManagerOptions) {
    this.activation = options.activation;
    this.playbackSpeed = options.playbackSpeed ?? 1;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this._fetchFixtures = options.fetchFixtures ?? this.defaultFetchFixtures.bind(this);
    this._fetchHistoricalData = options.fetchHistoricalData ?? this.defaultFetchHistoricalData.bind(this);
    this._processEvent = options.processEvent ?? normalizeScoreEvent;
  }

  // ─── Public Properties ───────────────────────────────────────────────────

  /** Whether Replay Mode is currently active and streaming events. */
  get isReplayActive(): boolean {
    return this._isReplayActive;
  }

  /** The fixtureId currently being replayed, or null if not in replay mode. */
  get currentFixtureId(): string | null {
    return this._currentFixtureId;
  }

  /**
   * Overrides the playback speed multiplier (1 = real-time). Only takes
   * effect for replays started after this call — does not retime an
   * already-scheduled replay.
   */
  setPlaybackSpeed(speed: number): void {
    this.playbackSpeed = speed;
  }

  // ─── Core Methods ────────────────────────────────────────────────────────

  /**
   * Fetches the fixture list and checks whether any covered fixture is currently live.
   * Returns true if at least one covered fixture is live, false otherwise.
   *
   * Requirement 3.1: Detect when no covered fixture is live.
   */
  async checkFixtureAvailability(): Promise<boolean> {
    try {
      const fixtures = await this._fetchFixtures();
      const hasLiveCoveredFixture = fixtures.some(
        (f) => f.state === 'live' && f.coverage === true
      );
      return hasLiveCoveredFixture;
    } catch (error) {
      console.error('[ReplayManager] Error checking fixture availability:', error);
      // On error, assume no live fixture → allow replay mode entry
      return false;
    }
  }

  /**
   * Starts polling for fixture availability at the configured interval.
   * When no live covered fixture is detected, automatically enters Replay Mode.
   *
   * Requirement 3.1: Poll and detect when no live fixture is active.
   */
  startPolling(intervalMs?: number): void {
    const interval = intervalMs ?? this.pollIntervalMs;

    // Clear any existing poll timer
    this.stopPolling();

    // Run immediately on start
    this.pollAndCheck();

    // Then poll at the configured interval
    this.pollTimer = setInterval(() => {
      this.pollAndCheck();
    }, interval);
  }

  /**
   * Stops the fixture availability polling loop.
   */
  stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Selects a recently-finished fixture from the valid historical window.
   * Window: between 6 hours and 14 days after kickoff.
   * Prioritizes World Cup fixtures and high-profile teams.
   *
   * Requirement 3.2: Select recently-finished fixture from valid window.
   */
  async selectReplayFixture(): Promise<TxLINEFixture | null> {
    try {
      const fixtures = await this._fetchFixtures();
      const now = Date.now();

      // Filter to recently-finished fixtures within the valid window
      const candidates = fixtures.filter((f) => {
        if (f.state !== 'finished') return false;
        const kickoffTime = new Date(f.kickoff).getTime();
        const age = now - kickoffTime;
        return age >= MIN_FIXTURE_AGE_MS && age <= MAX_FIXTURE_AGE_MS;
      });

      if (candidates.length === 0) return null;

      // Score and sort candidates by priority
      const scored = candidates.map((f) => ({
        fixture: f,
        score: this.computeFixturePriority(f),
      }));

      scored.sort((a, b) => b.score - a.score);
      return scored[0].fixture;
    } catch (error) {
      console.error('[ReplayManager] Error selecting replay fixture:', error);
      return null;
    }
  }

  /**
   * Enters Replay Mode: selects a fixture, fetches historical data, and begins streaming.
   *
   * Requirements 3.1, 3.2, 3.3, 3.4.
   */
  async enterReplayMode(): Promise<void> {
    if (this._isReplayActive) {
      console.warn('[ReplayManager] Already in Replay Mode.');
      return;
    }

    const fixture = await this.selectReplayFixture();
    if (!fixture) {
      console.error('[ReplayManager] No suitable fixture found for replay.');
      return;
    }

    this._currentFixtureId = fixture.fixtureId;
    this._isReplayActive = true;

    console.log(
      `[ReplayManager] Entering Replay Mode with fixture ${fixture.fixtureId} ` +
        `(${fixture.homeTeam} vs ${fixture.awayTeam}) at ${this.playbackSpeed}x speed`
    );

    await this.streamHistoricalEvents(fixture.fixtureId);
  }

  /**
   * Fetches historical match data and streams events through the event bus
   * with original time spacing (real-time) or accelerated cadence.
   *
   * Requirements 3.3, 3.4: GET historical data, stream through same event bus.
   */
  async streamHistoricalEvents(fixtureId: string): Promise<void> {
    const rawEvents = await this._fetchHistoricalData(fixtureId);

    if (!rawEvents || rawEvents.length === 0) {
      console.warn(`[ReplayManager] No historical events found for fixture ${fixtureId}`);
      this.exitReplayMode();
      return;
    }

    // Trim pre-match coverage setup / post-match idle time — see
    // trimToMatchWindow's docstring for why this matters for real-time replay.
    const events = trimToMatchWindow(rawEvents);
    console.log(
      `[ReplayManager] Trimmed ${rawEvents.length} raw events to ${events.length} within the match window`,
    );

    // Set active state here (not just in enterReplayMode) so callers that invoke
    // this method directly — e.g. the manual /api/demo/replay trigger, which
    // bypasses enterReplayMode's fixture auto-selection — still get a correctly
    // armed _isReplayActive flag. Each scheduled event below is a no-op unless
    // this is true.
    this._currentFixtureId = fixtureId;
    this._isReplayActive = true;

    // Sort events by timestamp to ensure correct ordering
    const sorted = [...events].sort((a, b) => (a.Ts ?? 0) - (b.Ts ?? 0));

    // Calculate base timestamp (first event) for relative timing
    const baseTimestamp = sorted[0].Ts ?? 0;

    // Schedule each event with original time spacing, adjusted by playback speed
    for (let i = 0; i < sorted.length; i++) {
      const event = sorted[i];
      const relativeDelay = ((event.Ts ?? 0) - baseTimestamp) / this.playbackSpeed;

      const timeout = setTimeout(async () => {
        if (!this._isReplayActive) return;

        try {
          await this._processEvent(event);
        } catch (error) {
          console.error('[ReplayManager] Error processing historical event:', error);
        }

        // If this is the last event, exit replay mode after processing
        if (i === sorted.length - 1) {
          console.log(`[ReplayManager] Replay completed for fixture ${fixtureId}`);
          this.exitReplayMode();
        }
      }, relativeDelay);

      this.streamTimeouts.push(timeout);
    }
  }

  /**
   * Exits Replay Mode: stops all streaming, clears state.
   */
  exitReplayMode(): void {
    // Clear all scheduled event timeouts
    for (const timeout of this.streamTimeouts) {
      clearTimeout(timeout);
    }
    this.streamTimeouts = [];

    this._isReplayActive = false;
    this._currentFixtureId = null;

    console.log('[ReplayManager] Exited Replay Mode.');
  }

  /**
   * Full shutdown: stops polling and exits replay mode.
   */
  shutdown(): void {
    this.stopPolling();
    this.exitReplayMode();
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Internal poll-and-check: if no live fixture, enter replay mode.
   */
  private async pollAndCheck(): Promise<void> {
    const hasLive = await this.checkFixtureAvailability();
    if (!hasLive && !this._isReplayActive) {
      await this.enterReplayMode();
    } else if (hasLive && this._isReplayActive) {
      // A live fixture appeared — exit replay to switch to live mode
      console.log('[ReplayManager] Live fixture detected, exiting Replay Mode.');
      this.exitReplayMode();
    }
  }

  /**
   * Computes a priority score for fixture selection.
   * Higher score = more desirable for replay.
   *
   * Priority factors:
   *   - World Cup league: +100
   *   - High-profile teams: +10 per team
   *   - More recent: +1 to +5 (based on recency)
   */
  private computeFixturePriority(fixture: TxLINEFixture): number {
    let score = 0;

    // World Cup priority (+100)
    const isWorldCup = WORLD_CUP_LEAGUES.some(
      (wc) => fixture.league.toLowerCase().includes(wc.toLowerCase())
    );
    if (isWorldCup) score += 100;

    // High-profile teams (+10 each)
    const homeIsHighProfile = HIGH_PROFILE_TEAMS.some(
      (team) => fixture.homeTeam.toLowerCase().includes(team.toLowerCase())
    );
    const awayIsHighProfile = HIGH_PROFILE_TEAMS.some(
      (team) => fixture.awayTeam.toLowerCase().includes(team.toLowerCase())
    );
    if (homeIsHighProfile) score += 10;
    if (awayIsHighProfile) score += 10;

    // Recency bonus (more recent = higher, up to +5)
    const kickoffTime = new Date(fixture.kickoff).getTime();
    const age = Date.now() - kickoffTime;
    const recencyFraction = 1 - (age - MIN_FIXTURE_AGE_MS) / (MAX_FIXTURE_AGE_MS - MIN_FIXTURE_AGE_MS);
    score += Math.max(0, Math.min(5, recencyFraction * 5));

    return score;
  }

  /**
   * Default implementation: fetches fixtures from the real TxLINE API.
   *
   * `GET /fixtures` (the endpoint this previously called) doesn't exist on
   * the real TxLINE API — confirmed via the vendored devnet example scripts,
   * which use `GET /fixtures/snapshot?competitionId=X&startEpochDay=Y`
   * instead. Queries the current and previous 10-day snapshot window (see
   * SNAPSHOT_WINDOW_DAYS) to cover the full replay-candidate lookback.
   */
  private async defaultFetchFixtures(): Promise<TxLINEFixture[]> {
    const todayEpochDay = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
    const currentWindowStart = Math.floor(todayEpochDay / SNAPSHOT_WINDOW_DAYS) * SNAPSHOT_WINDOW_DAYS;
    const previousWindowStart = currentWindowStart - SNAPSHOT_WINDOW_DAYS;

    const [current, previous] = await Promise.all([
      this.fetchFixturesSnapshot(currentWindowStart),
      this.fetchFixturesSnapshot(previousWindowStart),
    ]);

    const byFixtureId = new Map<string, TxLINEFixture>();
    for (const fixture of [...previous, ...current]) {
      byFixtureId.set(fixture.fixtureId, fixture);
    }
    return [...byFixtureId.values()];
  }

  /** Fetches and maps one `/fixtures/snapshot` window. */
  private async fetchFixturesSnapshot(startEpochDay: number): Promise<TxLINEFixture[]> {
    const { txlineApiBaseUrl } = getEnvConfig();
    // txlineApiBaseUrl already includes /api (e.g. https://txline-dev.txodds.com/api) —
    // do not add another /api segment here.
    const url =
      `${txlineApiBaseUrl}/fixtures/snapshot?competitionId=${WORLD_CUP_COMPETITION_ID}` +
      `&startEpochDay=${startEpochDay}`;

    const headers = this.activation.getAuthHeaders();

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...headers,
        'Accept-Encoding': 'gzip',
      },
    });

    if (!response.ok) {
      throw new Error(
        `[ReplayManager] Failed to fetch fixtures snapshot (startEpochDay=${startEpochDay}): ` +
          `${response.status} ${response.statusText}`
      );
    }

    const data = await response.json() as TxLINERawFixtureSnapshot[];
    return data.map(mapRawFixtureSnapshot);
  }

  /**
   * Default implementation: fetches historical score data for a fixture.
   *
   * Requirement 3.3: GET /api/scores/historical/{fixtureId}
   */
  private async defaultFetchHistoricalData(fixtureId: string): Promise<TxLINERawScoreEvent[]> {
    const { txlineApiBaseUrl } = getEnvConfig();
    // txlineApiBaseUrl already includes /api — do not add another /api segment here.
    const url = `${txlineApiBaseUrl}/scores/historical/${fixtureId}`;

    const headers = this.activation.getAuthHeaders();

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...headers,
        'Accept-Encoding': 'gzip',
      },
    });

    if (!response.ok) {
      throw new Error(
        `[ReplayManager] Failed to fetch historical data for fixture ${fixtureId}: ` +
          `${response.status} ${response.statusText}`
      );
    }

    // The historical endpoint returns `text/event-stream` SSE-formatted content
    // (`data: {...}` blocks) even though it's a complete, non-live response —
    // NOT a JSON array. Parse it the same way as the live SSE stream.
    const bodyText = await response.text();
    return parseHistoricalScoreEvents(bodyText);
  }
}

// ─── Fixture Snapshot Mapping ────────────────────────────────────────────────

/**
 * Maps a raw `/fixtures/snapshot` entry to the internal `TxLINEFixture` shape
 * used by fixture selection/priority scoring. `state` is inferred from
 * `StartTime` vs now (see ASSUMED_MAX_MATCH_DURATION_MS) since the API
 * doesn't document a live/finished GameState value. `coverage` is always
 * true: the free-tier subscription only returns fixtures for leagues it's
 * actually entitled to, so anything present in the response is covered.
 */
function mapRawFixtureSnapshot(raw: TxLINERawFixtureSnapshot): TxLINEFixture {
  const gameState = raw.GameState ?? raw.gameState;
  const now = Date.now();
  const matchEnd = raw.StartTime + ASSUMED_MAX_MATCH_DURATION_MS;

  let state: string;
  if (gameState === 6) {
    state = 'cancelled';
  } else if (now < raw.StartTime) {
    state = 'scheduled';
  } else if (now <= matchEnd) {
    state = 'live';
  } else {
    state = 'finished';
  }

  return {
    fixtureId: String(raw.FixtureId),
    sport: 'Soccer',
    league: raw.Competition ?? 'World Cup',
    homeTeam: raw.Participant1IsHome ? raw.Participant1 : raw.Participant2,
    awayTeam: raw.Participant1IsHome ? raw.Participant2 : raw.Participant1,
    kickoff: new Date(raw.StartTime).toISOString(),
    state,
    coverage: true,
  };
}

// ─── SSE Body Parsing (historical endpoint) ─────────────────────────────────

/**
 * Parses a complete SSE-formatted response body (`data: {...}` blocks
 * separated by blank lines) into an array of raw score events. Skips
 * heartbeat-only entries that carry no FixtureId.
 */
function parseHistoricalScoreEvents(body: string): TxLINERawScoreEvent[] {
  const events: TxLINERawScoreEvent[] = [];

  for (const block of body.split(/\r?\n\r?\n/)) {
    for (const line of block.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr) continue;

      try {
        const parsed = JSON.parse(jsonStr) as TxLINERawScoreEvent;
        if (parsed.FixtureId !== undefined) {
          events.push(parsed);
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  return events;
}

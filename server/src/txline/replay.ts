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
    const events = await this._fetchHistoricalData(fixtureId);

    if (!events || events.length === 0) {
      console.warn(`[ReplayManager] No historical events found for fixture ${fixtureId}`);
      this.exitReplayMode();
      return;
    }

    // Sort events by timestamp to ensure correct ordering
    const sorted = [...events].sort((a, b) => a.ts - b.ts);

    // Calculate base timestamp (first event) for relative timing
    const baseTimestamp = sorted[0].ts;

    // Schedule each event with original time spacing, adjusted by playback speed
    for (let i = 0; i < sorted.length; i++) {
      const event = sorted[i];
      const relativeDelay = (event.ts - baseTimestamp) / this.playbackSpeed;

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
   * Default implementation: fetches fixtures from TxLINE API.
   */
  private async defaultFetchFixtures(): Promise<TxLINEFixture[]> {
    const { txlineApiBaseUrl } = getEnvConfig();
    const url = `${txlineApiBaseUrl}/api/fixtures`;

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
        `[ReplayManager] Failed to fetch fixtures: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json() as TxLINEFixture[];
    return data;
  }

  /**
   * Default implementation: fetches historical score data for a fixture.
   *
   * Requirement 3.3: GET /api/scores/historical/{fixtureId}
   */
  private async defaultFetchHistoricalData(fixtureId: string): Promise<TxLINERawScoreEvent[]> {
    const { txlineApiBaseUrl } = getEnvConfig();
    const url = `${txlineApiBaseUrl}/api/scores/historical/${fixtureId}`;

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

    const data = await response.json() as TxLINERawScoreEvent[];
    return data;
  }
}

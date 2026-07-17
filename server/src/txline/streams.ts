/**
 * TxLINE SSE Stream Manager
 *
 * Establishes fetch-based SSE connections to TxLINE scores and odds streams.
 * Standard EventSource doesn't support custom headers, so we use Node 20+
 * fetch with ReadableStream to parse server-sent events manually.
 *
 * Features:
 *   - Scores stream: parses events → normalizeScoreEvent()
 *   - Odds stream: stores ticks in odds_ticks table, detects 15%+ shifts
 *   - Exponential backoff reconnection [1s, 2s, 4s, 8s, 16s], max 5 attempts
 *   - After 5 failed reconnects: emits 'stream_failed' event
 *   - Heartbeat messages (empty data lines) handled as no-ops
 *
 * Requirements: 2.1, 2.2, 2.3, 2.9, 27.1
 */

import { EventEmitter } from 'node:events';
import { getEnvConfig } from '../config/env.js';
import { TxLINEActivation } from './activation.js';
import { normalizeScoreEvent } from './normalizer.js';
import { eventBus, ODDS_SHIFT_EVENT } from '../events/event-bus.js';
import type { OddsShiftEvent } from '../events/event-bus.js';
import { getSupabaseClient } from '../lib/supabase.js';
import type { OddsTicksInsert } from '../db/schema.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Exponential backoff delays in milliseconds for reconnection attempts. */
const BACKOFF_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

/** Maximum number of consecutive reconnection attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 5;

/** Threshold for odds shift detection: 15% change within 60-second window. */
const ODDS_SHIFT_THRESHOLD = 0.15;

/** Time window for odds shift detection (60 seconds in ms). */
const ODDS_SHIFT_WINDOW_MS = 60_000;

// ─── Types ───────────────────────────────────────────────────────────────────

export type StreamType = 'scores' | 'odds';

export interface StreamStatus {
  connected: boolean;
  reconnectAttempts: number;
  lastConnectedAt: number | null;
  lastError: string | null;
}

/** Raw TxLINE odds stream event shape. */
export interface TxLINERawOddsEvent {
  fixtureId: string;
  ts: number;
  market: string;
  prices: Record<string, number>; // e.g. { home: 2.10, away: 3.50, draw: 3.20 }
}

/** Internal odds price cache entry for shift detection. */
interface OddsPriceCacheEntry {
  price: number;
  timestamp: number;
}

// ─── TxLINEStreamManager ─────────────────────────────────────────────────────

/**
 * Manages SSE connections to TxLINE scores and odds streams.
 *
 * Usage:
 *   const manager = new TxLINEStreamManager(activation);
 *   manager.on('stream_failed', ({ streamType }) => enterReplayMode());
 *   await manager.connectScoresStream();
 *   await manager.connectOddsStream();
 *   // ... later
 *   manager.disconnect();
 */
export class TxLINEStreamManager extends EventEmitter {
  private activation: TxLINEActivation;
  private abortControllers: Map<StreamType, AbortController> = new Map();
  private reconnectTimers: Map<StreamType, ReturnType<typeof setTimeout>> = new Map();
  private reconnectAttempts: Map<StreamType, number> = new Map();
  private connected: Map<StreamType, boolean> = new Map();
  private lastConnectedAt: Map<StreamType, number | null> = new Map();
  private lastError: Map<StreamType, string | null> = new Map();

  /**
   * Odds price cache for shift detection.
   * Key: `${fixtureId}::${market}::${outcome}` → array of recent price entries
   */
  private oddsPriceCache: Map<string, OddsPriceCacheEntry[]> = new Map();

  constructor(activation: TxLINEActivation) {
    super();
    this.activation = activation;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Connects to the TxLINE scores SSE stream at `/api/scores/stream`.
   * Includes auth headers and gzip encoding.
   * Parsed events are passed to normalizeScoreEvent() for processing.
   */
  async connectScoresStream(): Promise<void> {
    const { txlineApiBaseUrl } = getEnvConfig();
    const url = `${txlineApiBaseUrl}/api/scores/stream`;
    await this.connectStream('scores', url, this.handleScoresData.bind(this));
  }

  /**
   * Connects to the TxLINE odds SSE stream at `/api/odds/stream`.
   * Includes auth headers and gzip encoding.
   * Parsed events are stored in odds_ticks and checked for shifts.
   */
  async connectOddsStream(): Promise<void> {
    const { txlineApiBaseUrl } = getEnvConfig();
    const url = `${txlineApiBaseUrl}/api/odds/stream`;
    await this.connectStream('odds', url, this.handleOddsData.bind(this));
  }

  /**
   * Disconnects all active SSE streams and cancels any pending reconnections.
   */
  disconnect(): void {
    for (const streamType of ['scores', 'odds'] as StreamType[]) {
      this.disconnectStream(streamType);
    }
    this.oddsPriceCache.clear();
  }

  /**
   * Returns the current status of a specific stream.
   */
  getStatus(streamType: StreamType): StreamStatus {
    return {
      connected: this.connected.get(streamType) ?? false,
      reconnectAttempts: this.reconnectAttempts.get(streamType) ?? 0,
      lastConnectedAt: this.lastConnectedAt.get(streamType) ?? null,
      lastError: this.lastError.get(streamType) ?? null,
    };
  }

  // ─── Core Stream Connection ──────────────────────────────────────────────

  /**
   * Establishes a fetch-based SSE connection with custom auth headers.
   * Standard EventSource doesn't support custom headers, so we use
   * fetch with a ReadableStream to parse SSE `data:` lines manually.
   */
  private async connectStream(
    streamType: StreamType,
    url: string,
    dataHandler: (jsonData: string) => Promise<void>,
  ): Promise<void> {
    // Clean up any existing connection for this stream (but preserve reconnect count)
    const currentAttempts = this.reconnectAttempts.get(streamType) ?? 0;
    this.disconnectStream(streamType);
    this.reconnectAttempts.set(streamType, currentAttempts);

    const abortController = new AbortController();
    this.abortControllers.set(streamType, abortController);

    const headers = {
      ...this.activation.getAuthHeaders(),
      'Accept-Encoding': 'gzip',
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    };

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(
          `[TxLINEStreams] ${streamType} stream returned ${response.status} ${response.statusText}`
        );
      }

      if (!response.body) {
        throw new Error(
          `[TxLINEStreams] ${streamType} stream response has no body`
        );
      }

      // Mark as connected
      this.connected.set(streamType, true);
      this.lastConnectedAt.set(streamType, Date.now());
      this.lastError.set(streamType, null);
      this.reconnectAttempts.set(streamType, 0);

      // Process the SSE stream
      this.processSSEStream(streamType, url, response.body, dataHandler);
    } catch (error) {
      if (abortController.signal.aborted) {
        // Intentional disconnect — do not reconnect
        return;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.lastError.set(streamType, errorMessage);
      this.connected.set(streamType, false);
      console.error(`[TxLINEStreams] ${streamType} connection failed:`, errorMessage);

      // Attempt reconnection
      this.scheduleReconnect(streamType, url, dataHandler);
    }
  }

  /**
   * Processes an SSE ReadableStream, parsing `data:` lines and dispatching
   * parsed JSON to the provided data handler.
   *
   * Handles:
   *   - `data:` lines containing JSON payloads
   *   - Empty `data:` lines (heartbeats) as no-ops
   *   - Stream end/error → triggers reconnection
   */
  private processSSEStream(
    streamType: StreamType,
    url: string,
    body: ReadableStream<Uint8Array>,
    dataHandler: (jsonData: string) => Promise<void>,
  ): void {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const read = async (): Promise<void> => {
      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            // Stream ended — attempt reconnection
            this.connected.set(streamType, false);
            console.warn(`[TxLINEStreams] ${streamType} stream ended`);
            this.scheduleReconnect(streamType, url, dataHandler);
            return;
          }

          buffer += decoder.decode(value, { stream: true });

          // Process complete lines from the buffer
          const lines = buffer.split('\n');
          // Keep the last incomplete line in the buffer
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();

            // Empty line — SSE event boundary or heartbeat
            if (trimmed === '' || trimmed === 'data:') {
              continue;
            }

            // Parse `data:` prefix
            if (trimmed.startsWith('data:')) {
              const jsonStr = trimmed.slice(5).trim();

              // Empty data line (heartbeat) — no-op
              if (jsonStr === '') {
                continue;
              }

              try {
                await dataHandler(jsonStr);
              } catch (parseError) {
                console.error(
                  `[TxLINEStreams] ${streamType} data handler error:`,
                  parseError instanceof Error ? parseError.message : String(parseError),
                );
              }
            }
            // Ignore other SSE fields (event:, id:, retry:, comments starting with :)
          }
        }
      } catch (error) {
        // Check if this was an intentional abort
        const abortController = this.abortControllers.get(streamType);
        if (abortController?.signal.aborted) {
          return;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        this.connected.set(streamType, false);
        this.lastError.set(streamType, errorMessage);
        console.error(`[TxLINEStreams] ${streamType} stream read error:`, errorMessage);

        this.scheduleReconnect(streamType, url, dataHandler);
      }
    };

    // Start reading without blocking
    void read();
  }

  // ─── Reconnection Logic ──────────────────────────────────────────────────

  /**
   * Schedules a reconnection attempt with exponential backoff.
   * Backoff delays: [1s, 2s, 4s, 8s, 16s].
   * After 5 failed attempts, emits 'stream_failed' event (enter Replay Mode).
   */
  private scheduleReconnect(
    streamType: StreamType,
    url: string,
    dataHandler: (jsonData: string) => Promise<void>,
  ): void {
    const attempts = this.reconnectAttempts.get(streamType) ?? 0;

    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      // All reconnection attempts exhausted — emit failure event
      console.error(
        `[TxLINEStreams] ${streamType} stream: all ${MAX_RECONNECT_ATTEMPTS} reconnect attempts failed. Entering Replay Mode.`
      );
      this.emit('stream_failed', { streamType, attempts });
      return;
    }

    const delayMs = BACKOFF_DELAYS_MS[attempts];
    this.reconnectAttempts.set(streamType, attempts + 1);

    console.warn(
      `[TxLINEStreams] ${streamType} stream: scheduling reconnect attempt ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS} in ${delayMs}ms`
    );

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(streamType);
      void this.connectStream(streamType, url, dataHandler);
    }, delayMs);

    this.reconnectTimers.set(streamType, timer);
  }

  // ─── Stream Disconnect ───────────────────────────────────────────────────

  /**
   * Disconnects a specific stream and cancels pending reconnection.
   */
  private disconnectStream(streamType: StreamType): void {
    // Abort any active fetch
    const abortController = this.abortControllers.get(streamType);
    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(streamType);
    }

    // Cancel pending reconnection timer
    const timer = this.reconnectTimers.get(streamType);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(streamType);
    }

    this.connected.set(streamType, false);
  }

  // ─── Scores Stream Data Handler ──────────────────────────────────────────

  /**
   * Handles parsed JSON data from the scores SSE stream.
   * Passes events to normalizeScoreEvent() which emits typed events
   * on the internal event bus and persists to match_events table.
   */
  private async handleScoresData(jsonData: string): Promise<void> {
    const event = JSON.parse(jsonData);
    await normalizeScoreEvent(event);
  }

  // ─── Odds Stream Data Handler ────────────────────────────────────────────

  /**
   * Handles parsed JSON data from the odds SSE stream.
   * 1. Stores the tick in odds_ticks table
   * 2. Checks for price shifts exceeding 15% within 60s window
   * 3. Emits ODDS_SHIFT_EVENT if threshold exceeded
   */
  private async handleOddsData(jsonData: string): Promise<void> {
    const event = JSON.parse(jsonData) as TxLINERawOddsEvent;
    const { fixtureId, ts, market, prices } = event;

    // Store odds tick in database
    await this.storeOddsTick(fixtureId, ts, market, prices);

    // Check for price shifts per outcome
    for (const [outcome, currentPrice] of Object.entries(prices)) {
      if (typeof currentPrice !== 'number' || currentPrice <= 0) continue;

      const cacheKey = `${fixtureId}::${market}::${outcome}`;
      const entries = this.oddsPriceCache.get(cacheKey) ?? [];

      // Prune entries outside the 60-second window
      const windowStart = ts - ODDS_SHIFT_WINDOW_MS;
      const validEntries = entries.filter((e) => e.timestamp >= windowStart);

      // Check for shift against the oldest valid entry
      if (validEntries.length > 0) {
        const oldestEntry = validEntries[0];
        const percentChange = Math.abs(
          (currentPrice - oldestEntry.price) / oldestEntry.price
        );

        if (percentChange >= ODDS_SHIFT_THRESHOLD) {
          const oddsShift: OddsShiftEvent = {
            fixtureId,
            timestamp: ts,
            market,
            oldPrice: oldestEntry.price,
            newPrice: currentPrice,
            percentChange,
          };
          eventBus.emit(ODDS_SHIFT_EVENT, oddsShift);
        }
      }

      // Add current price to cache
      validEntries.push({ price: currentPrice, timestamp: ts });
      this.oddsPriceCache.set(cacheKey, validEntries);
    }
  }

  /**
   * Stores an odds tick in the odds_ticks table.
   */
  private async storeOddsTick(
    fixtureId: string,
    ts: number,
    market: string,
    prices: Record<string, number>,
  ): Promise<void> {
    const supabase = getSupabaseClient();

    const record: OddsTicksInsert = {
      fixture_id: Number(fixtureId),
      ts,
      market,
      price_json: prices as unknown as Record<string, unknown>,
    };

    const { error } = await supabase.from('odds_ticks').insert(record);

    if (error) {
      // Log but don't throw — stream processing shouldn't block on persistence failure
      console.error('[TxLINEStreams] Failed to store odds tick:', error.message);
    }
  }
}

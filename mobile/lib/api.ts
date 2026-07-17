/**
 * TRIBE Mobile App — REST API client with WebSocket fallback for read commits
 *
 * All on-chain operations happen server-side. This module provides typed
 * functions for each REST endpoint and implements channel selection logic
 * for read commits (WS-first, REST fallback).
 */

import type {
  Fixture,
  TribeRanking,
  TimelineMoment,
  WrappedStats,
  FanProfile,
  ReadCommitMessage,
} from '../types';
import { useAuthStore } from '../stores/useAuthStore';
import { useCampfireStore } from '../stores/useCampfireStore';

// ─── Configuration ───────────────────────────────────────────────────────────

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type CommitChannel = 'websocket' | 'rest';

export interface ReadCommitPayload {
  readId: string;
  predicted: number;
  fanId: string;
  timestamp: number;
}

export interface TimelineResponse {
  moments: TimelineMoment[];
  wrapped: WrappedStats;
}

export interface RegisterPayload {
  privyUserId: string;
  tribeId: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the auth token from the auth store for use in request headers.
 */
function getAuthToken(): string | null {
  return useAuthStore.getState().token;
}

/**
 * Builds standard request headers with auth token.
 */
function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Determines the commit channel based on WebSocket connection state.
 * Exported for testability (Property 5).
 */
export function getCommitChannel(connected: boolean): CommitChannel {
  return connected ? 'websocket' : 'rest';
}

/**
 * Builds a ReadCommitMessage from the given parameters.
 * Exported for testability (Property 14).
 */
export function buildCommitMessage(
  readId: string,
  predicted: number,
  fanId: string,
): ReadCommitMessage {
  return {
    type: 'read_commit',
    payload: {
      readId,
      predicted,
      fanId,
      timestamp: Date.now(),
    },
  };
}

// ─── REST API Functions ──────────────────────────────────────────────────────

/**
 * GET /api/fixtures/live
 * Fetches the list of currently live fixtures.
 */
export async function fetchLiveFixtures(): Promise<ApiResult<Fixture[]>> {
  try {
    const response = await fetch(`${BASE_URL}/api/fixtures/live`, {
      method: 'GET',
      headers: buildHeaders(),
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const data: Fixture[] = await response.json();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error fetching fixtures',
    };
  }
}

/**
 * GET /api/tribe/:tribeId/standings?view=global|country|city
 * Fetches tribe standings for the specified view.
 */
export async function fetchStandings(
  tribeId: string,
  view: 'global' | 'country' | 'city',
): Promise<ApiResult<TribeRanking[]>> {
  try {
    const response = await fetch(
      `${BASE_URL}/api/tribe/${encodeURIComponent(tribeId)}/standings?view=${view}`,
      {
        method: 'GET',
        headers: buildHeaders(),
      },
    );

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const data: TribeRanking[] = await response.json();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error fetching standings',
    };
  }
}

/**
 * GET /api/fan/:fanId/timeline
 * Fetches the fan's timeline moments and wrapped stats.
 */
export async function fetchTimeline(
  fanId: string,
): Promise<ApiResult<TimelineResponse>> {
  try {
    const response = await fetch(
      `${BASE_URL}/api/fan/${encodeURIComponent(fanId)}/timeline`,
      {
        method: 'GET',
        headers: buildHeaders(),
      },
    );

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const data: TimelineResponse = await response.json();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error fetching timeline',
    };
  }
}

/**
 * POST /api/read/commit
 * REST fallback for committing a Read prediction when WebSocket is disconnected.
 */
export async function postReadCommit(
  payload: ReadCommitPayload,
): Promise<ApiResult<ReadCommitPayload>> {
  try {
    const response = await fetch(`${BASE_URL}/api/read/commit`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const data: ReadCommitPayload = await response.json();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error committing read',
    };
  }
}

/**
 * POST /api/auth/register
 * Registers a new fan after Privy authentication.
 */
export async function registerFan(
  payload: RegisterPayload,
): Promise<ApiResult<FanProfile>> {
  try {
    const response = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const data: FanProfile = await response.json();
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error registering fan',
    };
  }
}

// ─── Channel Selection: Read Commit with WS/REST fallback ────────────────────

/**
 * Commits a Read prediction using the appropriate channel:
 * - If WebSocket is connected → sends ReadCommitMessage via WS
 * - If WebSocket is disconnected → POSTs to /api/read/commit
 *
 * @param readId - The unique read prompt identifier
 * @param predicted - The fan's prediction (0 = NO, 1 = YES)
 * @param fanId - The fan's unique identifier
 * @param wsSend - Optional WebSocket send function (injected by the socket hook)
 * @returns The channel used and the result of the commit
 */
export async function commitReadWithFallback(
  readId: string,
  predicted: number,
  fanId: string,
  wsSend?: (message: ReadCommitMessage) => void,
): Promise<{ channel: CommitChannel; result: ApiResult<ReadCommitPayload> }> {
  const { connected } = useCampfireStore.getState();
  const channel = getCommitChannel(connected);
  const message = buildCommitMessage(readId, predicted, fanId);

  if (channel === 'websocket' && wsSend) {
    try {
      wsSend(message);
      return {
        channel: 'websocket',
        result: { ok: true, data: message.payload },
      };
    } catch (error) {
      // WS send failed — fall through to REST
      const restResult = await postReadCommit(message.payload);
      return { channel: 'rest', result: restResult };
    }
  }

  // REST fallback path
  const restResult = await postReadCommit(message.payload);
  return { channel: 'rest', result: restResult };
}

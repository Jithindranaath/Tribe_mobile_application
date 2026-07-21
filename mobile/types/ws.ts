/**
 * WebSocket type definitions
 */

// ─── Event Types ─────────────────────────────────────────────────────────────

export type WSEventType =
  | 'presence'
  | 'conviction'
  | 'read_prompt'
  | 'surge'
  | 'keeper_inject'
  | 'standing_update'
  | 'share_card_ready'
  | 'match_header';

export interface WSMessage<T extends WSEventType = WSEventType> {
  type: T;
  payload: unknown;
  timestamp: number;
}

// ─── Payload Types ───────────────────────────────────────────────────────────

// Matches the server's real broadcastPresence payload shape exactly
// (server/src/ws/types.ts) — the two must agree since count/activeCount
// mismatched here silently sat at 0 forever (real presence data arrived,
// this field just didn't exist on it) until this was caught by watching a
// real WS connection's raw messages.
export interface PresencePayload {
  tribeId: string;
  fixtureId: string;
  count: number;
}

export interface ConvictionPayload {
  signal: number;
  percentage: number;
  tribeId: string;
}

export interface SurgePayload {
  readId: string;
  standingEarned: number;
  newStanding: number;
  message: string;
}

export interface KeeperInjectPayload {
  message: string;
  emotion: 'neutral' | 'tense' | 'euphoric' | 'dramatic';
}

export interface StandingUpdatePayload {
  fanId: string;
  standing: number;
  rank: number;
  change: number;
}

export interface ShareCardReadyPayload {
  cardId: string;
  imageUrl: string;
  readId: string;
}

export interface MatchHeaderPayload {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  state: 'scheduled' | 'live' | 'finished';
}

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
  | 'share_card_ready';

export interface WSMessage<T extends WSEventType = WSEventType> {
  type: T;
  payload: unknown;
  timestamp: number;
}

// ─── Payload Types ───────────────────────────────────────────────────────────

export interface PresencePayload {
  activeCount: number;
  tribeId: string;
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

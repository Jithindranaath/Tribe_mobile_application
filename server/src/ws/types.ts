// ─── WebSocket Message Types ─────────────────────────────────────────────────

/**
 * All possible WebSocket event types sent from server to client.
 */
export type WSEventType =
  | 'presence'
  | 'conviction'
  | 'read_prompt'
  | 'surge'
  | 'keeper_inject'
  | 'standing_update'
  | 'share_card_ready'
  | 'rank_update'
  | 'match_header';

/**
 * Base envelope for all WebSocket messages.
 */
export interface WSMessage<T extends WSEventType = WSEventType, P = unknown> {
  type: T;
  payload: P;
  timestamp: number;
}

// ─── Payload Interfaces ──────────────────────────────────────────────────────

export interface PresencePayload {
  tribeId: string;
  fixtureId: string;
  count: number;
}

export interface ConvictionPayload {
  readId: string;
  signal: number; // 0.0 to 1.0
  participantCount: number;
}

export interface ReadPromptPayload {
  readId: string;
  readType: 'moment_read' | 'momentum_read' | 'instinct_read';
  question: string;
  options: string[];
  difficultyMultiplier: number;
  expiresAt: number;
}

export interface SurgePayload {
  fixtureId: string;
  type: 'goal' | 'resolution';
  message: string;
  standingDeltas: Array<{
    fanId: string;
    delta: number;
  }>;
}

export interface KeeperInjectPayload {
  message: string;
  emotion?: 'neutral' | 'tension' | 'celebration';
}

export interface StandingUpdatePayload {
  fanId: string;
  newStanding: number;
  delta: number;
}

export interface ShareCardReadyPayload {
  fanId: string;
  cardId: string;
  imageUrl: string;
}

export interface RankUpdatePayload {
  tribeId: string;
  rank: number;
  previousRank?: number;
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

// ─── Typed Message Aliases ───────────────────────────────────────────────────

export type PresenceMessage = WSMessage<'presence', PresencePayload>;
export type ConvictionMessage = WSMessage<'conviction', ConvictionPayload>;
export type ReadPromptMessage = WSMessage<'read_prompt', ReadPromptPayload>;
export type SurgeMessage = WSMessage<'surge', SurgePayload>;
export type KeeperInjectMessage = WSMessage<'keeper_inject', KeeperInjectPayload>;
export type StandingUpdateMessage = WSMessage<'standing_update', StandingUpdatePayload>;
export type ShareCardReadyMessage = WSMessage<'share_card_ready', ShareCardReadyPayload>;
export type RankUpdateMessage = WSMessage<'rank_update', RankUpdatePayload>;
export type MatchHeaderMessage = WSMessage<'match_header', MatchHeaderPayload>;

/**
 * Union of all outbound message types.
 */
export type OutboundWSMessage =
  | PresenceMessage
  | ConvictionMessage
  | ReadPromptMessage
  | SurgeMessage
  | KeeperInjectMessage
  | StandingUpdateMessage
  | ShareCardReadyMessage
  | RankUpdateMessage
  | MatchHeaderMessage;

// ─── Client → Server Messages ────────────────────────────────────────────────

export type ClientEventType = 'ping' | 'read_commit';

export interface ClientPingMessage {
  type: 'ping';
}

export interface ClientReadCommitMessage {
  type: 'read_commit';
  readId: string;
  predicted: number;
}

export type InboundWSMessage = ClientPingMessage | ClientReadCommitMessage;

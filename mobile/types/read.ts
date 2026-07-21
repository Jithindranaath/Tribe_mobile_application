/**
 * Read Flow type definitions
 */

export interface PendingRead {
  readId: string;
  predicted: number;
  committedAt: number;
  readType: 'moment_read' | 'momentum_read' | 'instinct_read';
  question: string;
}

/**
 * Flat shape — matches the server's real `ClientReadCommitMessage`
 * (server/src/ws/types.ts) exactly. The server derives fanId/tribeId/
 * fixtureId from the authenticated WS connection itself, not the message
 * body, so those aren't sent here.
 */
export interface ReadCommitMessage {
  type: 'read_commit';
  readId: string;
  predicted: number;
}

export interface ReadPromptPayload {
  readId: string;
  question: string;
  options: ['YES', 'NO'];
  multiplier: number;
  expiresAt: number;
  readType: 'moment_read' | 'momentum_read' | 'instinct_read';
}

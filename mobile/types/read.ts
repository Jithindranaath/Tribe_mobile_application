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

export interface ReadCommitMessage {
  type: 'read_commit';
  payload: {
    readId: string;
    predicted: number;
    fanId: string;
    timestamp: number;
  };
}

export interface ReadPromptPayload {
  readId: string;
  question: string;
  options: ['YES', 'NO'];
  multiplier: number;
  expiresAt: number;
  readType: 'moment_read' | 'momentum_read' | 'instinct_read';
}

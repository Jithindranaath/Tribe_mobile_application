/**
 * Timeline / Legacy type definitions
 */

export interface TimelineMoment {
  id: string;
  fanId: string;
  fixtureId: number;
  type: 'READ_SUCCESS' | 'TITLE_EARNED' | 'RANK_CLIMB';
  match: string;             // "Brazil 2-1 Argentina"
  prediction: string;        // "Next goal within 5 min"
  outcome: string;           // "Correct! +15 Standing"
  createdAt: string;
}

export interface WrappedStats {
  matchesWatched: number;
  readsMade: number;
  accuracyPercentage: number;
  bestCall: string;
  earnedTitles: string[];
  standingGained: number;
}

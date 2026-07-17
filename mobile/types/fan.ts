/**
 * Fan & Tribe type definitions
 */

export interface FanProfile {
  fanId: string;
  privyUserId: string;
  tribeId: string;
  tribeName: string;         // "Brazil · Hyderabad"
  macroTribe: string;        // "Brazil"
  standing: number;
  titles: number;            // bitmask: Seer=1, Chronicler=2, Kindler=4, Keeper=8
  readsCorrect: number;
  readsTotal: number;
  currentStreak: number;
}

export interface TribeRanking {
  tribeId: string;
  tribeName: string;
  aggregateStanding: number;
  memberCount: number;
  accuracyPercentage: number;
  rank: number;
  previousRank?: number;
}

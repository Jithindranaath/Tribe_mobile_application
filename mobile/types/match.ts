/**
 * Match, Fixture, Flame Intensity, and Title type definitions
 */

// ─── Match / Fixture ─────────────────────────────────────────────────────────

export interface MatchHeader {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  state: 'scheduled' | 'live' | 'finished';
}

export interface Fixture {
  fixtureId: number;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;           // ISO 8601
  state: 'scheduled' | 'live' | 'finished';
}

// ─── Flame Intensity ─────────────────────────────────────────────────────────

export type FlameIntensity = 'dim' | 'steady' | 'bright' | 'blazing';

/** Maps numeric flame/conviction signal (0–100) to intensity tier */
export function signalToIntensity(signal: number): FlameIntensity {
  if (signal <= 25) return 'dim';
  if (signal <= 50) return 'steady';
  if (signal <= 75) return 'bright';
  return 'blazing';
}

// ─── Title Bitmask ───────────────────────────────────────────────────────────

export enum Title {
  Seer = 1,        // 0001 — prediction accuracy
  Chronicler = 2,  // 0010 — timeline moments
  Kindler = 4,     // 0100 — tribe flame contribution
  Keeper = 8,      // 1000 — community leadership
}

/** Decodes a title bitmask into an array of individual Title values */
export function decodeTitles(bitmask: number): Title[] {
  return [Title.Seer, Title.Chronicler, Title.Kindler, Title.Keeper]
    .filter(t => (bitmask & t) !== 0);
}

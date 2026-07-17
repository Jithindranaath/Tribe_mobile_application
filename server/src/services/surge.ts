/**
 * Surge Service — broadcasts real-time surge events via WebSocket when a
 * GOAL_EVENT resolves pending Reads correctly.
 *
 * The surge fires within 500ms of GOAL_EVENT receipt, delivering Standing deltas
 * to all connected tribe members so the Campfire can trigger the "CALLED IT"
 * celebration animation.
 *
 * Requirements: 12.1, 12.5
 */

import type { Resolution } from './resolver.js';
import type { CampfireWSServer } from '../ws/server.js';
import type { SurgePayload } from '../ws/types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Resolves a fixtureId to the tribeId(s) that should receive the surge broadcast.
 * In practice, a fixture may involve multiple tribes; the resolver returns the
 * tribeId for the tribe room to broadcast to.
 */
export type TribeIdResolver = (fixtureId: string) => string | null;

export interface SurgeServiceOptions {
  /** The WebSocket server instance for broadcasting */
  wsServer: CampfireWSServer;
  /** Function that maps fixtureId → tribeId for routing broadcasts */
  tribeIdResolver: TribeIdResolver;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

/**
 * Builds a SurgePayload from resolved Reads.
 * Includes ALL standing deltas (correct and incorrect) so fans see their results.
 * Only produces a payload if at least one Read was correct.
 *
 * @param fixtureId - The fixture that triggered the surge
 * @param resolutions - All resolutions from the GOAL_EVENT
 * @returns SurgePayload or null if no correct reads exist
 */
export function buildSurgePayload(
  fixtureId: string,
  resolutions: Resolution[]
): SurgePayload | null {
  const hasCorrectRead = resolutions.some((r) => r.correct);

  if (!hasCorrectRead) {
    return null;
  }

  return {
    fixtureId,
    type: 'goal',
    message: 'CALLED IT',
    standingDeltas: resolutions.map((r) => ({
      fanId: r.fanId,
      delta: r.standingDelta,
    })),
  };
}

// ─── SurgeService Class ──────────────────────────────────────────────────────

export class SurgeService {
  private wsServer: CampfireWSServer;
  private tribeIdResolver: TribeIdResolver;

  constructor(options: SurgeServiceOptions) {
    this.wsServer = options.wsServer;
    this.tribeIdResolver = options.tribeIdResolver;
  }

  /**
   * Trigger surge broadcast for resolved Reads.
   * Should be called immediately after ReadResolver resolves reads for a GOAL_EVENT.
   *
   * Only broadcasts if at least one Read was resolved correctly.
   * Includes all standing deltas (correct and incorrect) so every fan
   * in the tribe sees their result during the surge moment.
   *
   * @param fixtureId - The fixture that triggered resolution
   * @param resolutions - All resolutions from this GOAL_EVENT
   */
  triggerSurge(fixtureId: string, resolutions: Resolution[]): void {
    if (resolutions.length === 0) {
      return;
    }

    const payload = buildSurgePayload(fixtureId, resolutions);

    if (!payload) {
      // No correct reads — no surge to celebrate
      return;
    }

    const tribeId = this.tribeIdResolver(fixtureId);

    if (!tribeId) {
      console.warn(
        `[SurgeService] Could not resolve tribeId for fixture ${fixtureId}; skipping surge`
      );
      return;
    }

    this.wsServer.broadcastSurge(tribeId, fixtureId, payload);

    console.log(
      `[SurgeService] Surge broadcast: fixture=${fixtureId} tribe=${tribeId} ` +
        `correct=${resolutions.filter((r) => r.correct).length}/${resolutions.length}`
    );
  }
}

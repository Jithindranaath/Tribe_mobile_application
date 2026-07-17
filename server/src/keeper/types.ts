// ─── Keeper Decision Types ───────────────────────────────────────────────────

/**
 * The action the Keeper decides to take for a given event.
 * - 'read_prompt': Surface a Read prompt to the tribe
 * - 'inject': Send a Keeper text inject to the Campfire
 * - 'silent': Do nothing (penalty active or not worth reacting to)
 */
export type KeeperAction = 'read_prompt' | 'inject' | 'silent';

/**
 * The Keeper's decision after evaluating a match event.
 */
export interface KeeperDecision {
  action: KeeperAction;
  fixtureId: string;
  eventType: string;
  reason: string;
}

/**
 * Per-fixture state tracked by the Keeper evaluator.
 */
export interface FixtureState {
  readsSurfaced: number;
  injectsSent: number;
  lastInjectTime: number | null;
  isPenaltyActive: boolean;
}

/**
 * Callback signature for downstream decision handling.
 */
export type OnDecisionCallback = (decision: KeeperDecision) => void;

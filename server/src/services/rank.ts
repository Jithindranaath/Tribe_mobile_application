/**
 * Tribe rank computation service (cron-style).
 *
 * Every 60 seconds, computes the rank of each sub-tribe within its macro-tribe
 * by sorting on aggregate_standing descending. Rank is written back to
 * TribeAccount.rank (off-chain for now; on-chain later).
 *
 * Requirements: 13.5
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TribeRankEntry {
  tribeId: string;
  macroId: number;
  regionId: number;
  aggregateStanding: number;
  rank: number;
}

export interface TribeData {
  tribeId: string;
  macroId: number;
  regionId: number;
  aggregateStanding: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class RankService {
  /** In-memory rank store keyed by tribeId */
  private ranks: Map<string, TribeRankEntry> = new Map();

  /** Mock tribes data (replace with on-chain/Supabase query later) */
  private tribes: TribeData[] = [];

  /** Interval handle */
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * Starts the rank computation interval.
   * @param intervalMs - How often to recompute ranks (default: 60_000ms)
   */
  start(intervalMs: number = 60_000): void {
    if (this.intervalHandle !== null) {
      return; // already running
    }

    // Compute immediately on start
    this.computeRanks();

    this.intervalHandle = setInterval(() => {
      this.computeRanks();
    }, intervalMs);

    console.log(`[RankService] Started with interval ${intervalMs}ms`);
  }

  /**
   * Stops the rank computation interval.
   */
  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      console.log('[RankService] Stopped');
    }
  }

  /**
   * Computes ranks for all tribes grouped by macro_id.
   *
   * Algorithm:
   *   1. Group tribes by macroId
   *   2. Within each group, sort by aggregateStanding descending
   *   3. Assign rank 1, 2, 3... within each group
   *   4. Store results in the in-memory ranks map
   */
  computeRanks(): void {
    // Group tribes by macroId
    const groups = new Map<number, TribeData[]>();

    for (const tribe of this.tribes) {
      const group = groups.get(tribe.macroId) ?? [];
      group.push(tribe);
      groups.set(tribe.macroId, group);
    }

    // Within each group, sort by aggregateStanding descending and assign rank
    for (const [macroId, group] of groups) {
      const sorted = [...group].sort((a, b) => b.aggregateStanding - a.aggregateStanding);

      for (let i = 0; i < sorted.length; i++) {
        const tribe = sorted[i];
        const entry: TribeRankEntry = {
          tribeId: tribe.tribeId,
          macroId: tribe.macroId,
          regionId: tribe.regionId,
          aggregateStanding: tribe.aggregateStanding,
          rank: i + 1,
        };
        this.ranks.set(tribe.tribeId, entry);
      }
    }
  }

  /**
   * Returns the current rank for a specific tribe.
   * @param tribeId - The tribe to look up
   * @returns The rank number, or undefined if tribe not found
   */
  getRank(tribeId: string): number | undefined {
    return this.ranks.get(tribeId)?.rank;
  }

  /**
   * Returns all tribe rankings.
   * @returns Array of all TribeRankEntry records
   */
  getAllRanks(): TribeRankEntry[] {
    return Array.from(this.ranks.values());
  }

  /**
   * Sets the in-memory tribes data.
   * Used for initialization or when tribe data changes.
   * @param tribes - Array of tribe data to rank
   */
  setTribes(tribes: TribeData[]): void {
    this.tribes = tribes;
  }

  /**
   * Updates a single tribe's aggregate standing.
   * Useful for incremental updates without replacing all data.
   * @param tribeId - The tribe to update
   * @param aggregateStanding - New aggregate standing value
   */
  updateTribeStanding(tribeId: string, aggregateStanding: number): void {
    const tribe = this.tribes.find((t) => t.tribeId === tribeId);
    if (tribe) {
      tribe.aggregateStanding = aggregateStanding;
    }
  }

  /**
   * Returns whether the cron interval is currently active.
   */
  isRunning(): boolean {
    return this.intervalHandle !== null;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const rankService = new RankService();

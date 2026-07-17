import { create } from "zustand";
import type { TribeRanking } from "../types";
import { fetchStandings as apiFetchStandings } from "../lib/api";
import { useAuthStore } from "./useAuthStore";

interface StandingsState {
  /** Top 50 global tribe rankings */
  globalRankings: TribeRanking[];
  /** Country-scoped tribe rankings */
  countryRankings: TribeRanking[];
  /** City-scoped tribe rankings */
  cityRankings: TribeRanking[];
  /** Fan's personal standing score */
  personalStanding: number;
  /** Fan's personal rank number */
  personalRank: number;
  /** Whether a fetch is in progress */
  isLoading: boolean;
  /** Timestamp of the last successful fetch */
  lastFetched: number | null;
  /** Fetch standings for a given view */
  fetchStandings: (view: "global" | "country" | "city") => Promise<void>;
}

export const useStandingsStore = create<StandingsState>((set) => ({
  globalRankings: [],
  countryRankings: [],
  cityRankings: [],
  personalStanding: 0,
  personalRank: 0,
  isLoading: false,
  lastFetched: null,

  fetchStandings: async (view) => {
    set({ isLoading: true });

    try {
      const fan = useAuthStore.getState().fan;
      const tribeId = fan?.tribeId;

      if (!tribeId) {
        // Cannot fetch without a tribe context
        return;
      }

      const result = await apiFetchStandings(tribeId, view);

      if (result.ok) {
        const rankings = result.data;
        const viewKey =
          view === "global"
            ? "globalRankings"
            : view === "country"
              ? "countryRankings"
              : "cityRankings";

        // Find the fan's personal rank within the fetched rankings
        const fanRanking = rankings.find((r) => r.tribeId === tribeId);

        set({
          [viewKey]: rankings,
          ...(fanRanking && {
            personalStanding: fanRanking.aggregateStanding,
            personalRank: fanRanking.rank,
          }),
        });
      }
    } finally {
      set({ isLoading: false, lastFetched: Date.now() });
    }
  },
}));

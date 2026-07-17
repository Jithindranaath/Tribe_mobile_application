import { create } from "zustand";
import type { TimelineMoment, WrappedStats } from "../types";
import { fetchTimeline as apiFetchTimeline } from "../lib/api";
import { useAuthStore } from "./useAuthStore";

interface TimelineState {
  /** Array of fan's timeline moments */
  moments: TimelineMoment[];
  /** Wrapped tournament summary stats */
  wrappedStats: WrappedStats | null;
  /** Whether a fetch is in progress */
  isLoading: boolean;
  /** Fetch the fan's timeline from the server */
  fetchTimeline: () => Promise<void>;
}

export const useTimelineStore = create<TimelineState>((set) => ({
  moments: [],
  wrappedStats: null,
  isLoading: false,

  fetchTimeline: async () => {
    const fan = useAuthStore.getState().fan;
    if (!fan) return;

    set({ isLoading: true });

    try {
      const result = await apiFetchTimeline(fan.fanId);
      if (result.ok) {
        set({
          moments: result.data.moments,
          wrappedStats: result.data.wrapped,
        });
      }
    } finally {
      set({ isLoading: false });
    }
  },
}));

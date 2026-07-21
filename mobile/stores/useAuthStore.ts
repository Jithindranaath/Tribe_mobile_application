import { create } from "zustand";
import type { FanProfile } from "../types";

interface AuthState {
  /** Authenticated fan profile */
  fan: FanProfile | null;
  /** JWT or session token */
  token: string | null;
  /** Whether the fan has completed onboarding */
  isOnboarded: boolean;
  /** Currently selected tribe ID */
  selectedTribeId: string | null;
  /** Display name for the selected tribe, e.g. "Brazil · Hyderabad" */
  selectedTribeName: string | null;
  /** Display name for the selected macro tribe (team/country), e.g. "Brazil" */
  selectedMacroTribe: string | null;
  /** Clear auth state */
  logout: () => void;
  /** Set the selected tribe */
  setTribe: (tribeId: string, tribeName: string, macroTribe: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  fan: null,
  token: null,
  isOnboarded: false,
  selectedTribeId: null,
  selectedTribeName: null,
  selectedMacroTribe: null,

  logout: () =>
    set({
      fan: null,
      token: null,
      isOnboarded: false,
      selectedTribeId: null,
      selectedTribeName: null,
      selectedMacroTribe: null,
    }),

  setTribe: (tribeId, tribeName, macroTribe) =>
    set({ selectedTribeId: tribeId, selectedTribeName: tribeName, selectedMacroTribe: macroTribe }),
}));

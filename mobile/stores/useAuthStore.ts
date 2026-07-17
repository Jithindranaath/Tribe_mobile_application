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
  /** Login via social provider (stub — real impl delegates to Privy SDK) */
  login: (provider: "google" | "apple" | "email") => Promise<void>;
  /** Clear auth state */
  logout: () => void;
  /** Set the selected tribe */
  setTribe: (tribeId: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  fan: null,
  token: null,
  isOnboarded: false,
  selectedTribeId: null,

  login: async (_provider) => {
    // Actual implementation will integrate with Privy RN SDK
    // and POST to /api/auth/register on the server.
    // This is a store-level placeholder; the hook/provider will
    // call set() with the real fan profile and token after auth.
  },

  logout: () =>
    set({
      fan: null,
      token: null,
      isOnboarded: false,
      selectedTribeId: null,
    }),

  setTribe: (tribeId) => set({ selectedTribeId: tribeId }),
}));

import { create } from "zustand";

export type ThemePreference = "system" | "dark" | "light";

interface SettingsState {
  /** User's explicit theme preference. "system" means follow device setting. */
  themePreference: ThemePreference;
  /** Whether push notifications are enabled */
  notificationsEnabled: boolean;
  /** Set theme preference */
  setThemePreference: (preference: ThemePreference) => void;
  /** Toggle notification preference */
  setNotificationsEnabled: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  themePreference: "system",
  notificationsEnabled: true,
  setThemePreference: (preference) => set({ themePreference: preference }),
  setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),
}));

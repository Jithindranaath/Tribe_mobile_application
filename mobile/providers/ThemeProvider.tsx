import React, { createContext, useCallback, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import {
  ThemePreference,
  useSettingsStore,
} from "../stores/useSettingsStore";

export type ColorScheme = "dark" | "light";

interface ThemeContextValue {
  /** The resolved color scheme currently applied (dark or light) */
  colorScheme: ColorScheme;
  /** The user's preference setting (system, dark, or light) */
  themePreference: ThemePreference;
  /** Set the theme preference. "system" follows device, otherwise explicit. */
  setThemePreference: (preference: ThemePreference) => void;
  /** Convenience toggle between dark and light (sets explicit preference) */
  toggleTheme: () => void;
  /** Whether the current theme is dark */
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
}

/**
 * ThemeProvider wraps the app at root layout level.
 *
 * Behavior:
 * - Default: solarized dark theme
 * - When themePreference is "system": follows device system preference,
 *   falling back to dark if system preference is null/undefined
 * - When themePreference is "dark" or "light": uses explicit override
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const systemColorScheme = useColorScheme();
  const themePreference = useSettingsStore((s) => s.themePreference);
  const setThemePreference = useSettingsStore((s) => s.setThemePreference);

  // Resolve the active color scheme
  const colorScheme: ColorScheme = useMemo(() => {
    if (themePreference === "dark" || themePreference === "light") {
      return themePreference;
    }
    // "system" preference: follow device, default to dark (solarized dark)
    return systemColorScheme === "light" ? "light" : "dark";
  }, [themePreference, systemColorScheme]);

  const toggleTheme = useCallback(() => {
    // Toggle sets an explicit preference (no longer follows system)
    const next: ThemePreference = colorScheme === "dark" ? "light" : "dark";
    setThemePreference(next);
  }, [colorScheme, setThemePreference]);

  const value: ThemeContextValue = useMemo(
    () => ({
      colorScheme,
      themePreference,
      setThemePreference,
      toggleTheme,
      isDark: colorScheme === "dark",
    }),
    [colorScheme, themePreference, setThemePreference, toggleTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * Hook to access the current theme and theme controls.
 * Must be used within a ThemeProvider.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

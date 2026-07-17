/**
 * AuthProvider — Wraps @privy-io/expo PrivyProvider and syncs Privy auth
 * state with the app's useAuthStore (Zustand).
 *
 * Responsibilities:
 * - Configures Privy with the app ID from environment
 * - Monitors Privy auth state (user login/logout)
 * - Silently refreshes tokens via Privy SDK (getAccessToken)
 * - On login success: registers fan with server, persists profile + token
 * - On logout: clears auth store
 * - Embedded wallet creation is invisible to the fan (no wallet UI)
 */

import React, { useEffect, useRef, useCallback } from "react";
import {
  PrivyProvider as PrivySDKProvider,
  usePrivy,
  useLoginWithOAuth,
  useLoginWithEmail,
} from "@privy-io/expo";
import { useAuthStore } from "../stores/useAuthStore";
import { registerFan } from "../lib/api";

// ─── Configuration ───────────────────────────────────────────────────────────

const PRIVY_APP_ID =
  process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? "YOUR_PRIVY_APP_ID";

// When running with the mock (Expo Go), Privy hooks return stubs
const PRIVY_AVAILABLE = typeof PrivySDKProvider === "function" && PRIVY_APP_ID !== "YOUR_PRIVY_APP_ID";

// ─── Token Refresh Interval (ms) ────────────────────────────────────────────

const TOKEN_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ─── Auth Sync Component ─────────────────────────────────────────────────────

/**
 * Inner component that lives inside PrivySDKProvider and syncs Privy
 * auth state changes to the Zustand useAuthStore.
 */
function AuthStateSync({ children }: { children: React.ReactNode }) {
  const { user, isReady, getAccessToken, logout: privyLogout } = usePrivy();
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevUserIdRef = useRef<string | null>(null);

  const setStoreState = useAuthStore.setState;
  const selectedTribeId = useAuthStore((s) => s.selectedTribeId);
  const storedFan = useAuthStore((s) => s.fan);

  // ─── Sync Privy user state to auth store ─────────────────────────────────

  useEffect(() => {
    if (!isReady) return;

    const syncAuthState = async () => {
      if (user) {
        // User is authenticated in Privy
        const privyUserId = user.id;

        // Only register once per unique user session
        if (prevUserIdRef.current !== privyUserId) {
          prevUserIdRef.current = privyUserId;

          // Get access token for API calls
          const token = await getAccessToken();

          if (token) {
            setStoreState({ token });

            // If fan profile isn't loaded yet and we have a tribe, register
            if (!storedFan && selectedTribeId) {
              const result = await registerFan({
                privyUserId,
                tribeId: selectedTribeId,
              });

              if (result.ok) {
                setStoreState({
                  fan: result.data,
                  isOnboarded: true,
                });
              }
            } else if (storedFan) {
              // Returning user — just update token, keep existing profile
              setStoreState({ isOnboarded: true });
            }
          }
        }
      } else {
        // User logged out from Privy
        if (prevUserIdRef.current !== null) {
          prevUserIdRef.current = null;
          setStoreState({
            fan: null,
            token: null,
            isOnboarded: false,
            selectedTribeId: null,
          });
        }
      }
    };

    syncAuthState();
  }, [user, isReady, getAccessToken, selectedTribeId, storedFan, setStoreState]);

  // ─── Silent token refresh ────────────────────────────────────────────────

  useEffect(() => {
    if (!user) {
      // Clear timer when not authenticated
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      return;
    }

    // Refresh token periodically while authenticated
    refreshTimerRef.current = setInterval(async () => {
      try {
        const freshToken = await getAccessToken();
        if (freshToken) {
          setStoreState({ token: freshToken });
        }
      } catch {
        // Silent failure — Privy SDK handles expiry internally.
        // If token can't be refreshed, next getAccessToken call will re-auth.
      }
    }, TOKEN_REFRESH_INTERVAL);

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [user, getAccessToken, setStoreState]);

  // ─── Wire store logout to Privy logout ───────────────────────────────────

  useEffect(() => {
    // Override the store's logout to also trigger Privy logout
    const originalLogout = useAuthStore.getState().logout;
    useAuthStore.setState({
      logout: () => {
        originalLogout();
        privyLogout();
      },
    });
  }, [privyLogout]);

  return <>{children}</>;
}

// ─── AuthProvider (Public API) ───────────────────────────────────────────────

interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * AuthProvider wraps the app with Privy authentication.
 *
 * Usage in _layout.tsx:
 * ```tsx
 * <AuthProvider>
 *   <ThemeProvider>
 *     <RootLayoutNav />
 *   </ThemeProvider>
 * </AuthProvider>
 * ```
 *
 * The provider:
 * - Initializes Privy with the app ID
 * - Configures embedded Solana wallet creation on login (silent, no UI)
 * - Syncs auth state to useAuthStore
 * - Handles token persistence and silent refresh
 */
export function AuthProvider({ children }: AuthProviderProps) {
  // Skip Privy when native modules aren't available (Expo Go) or no valid app ID
  if (!PRIVY_AVAILABLE || !PRIVY_APP_ID || PRIVY_APP_ID === "YOUR_PRIVY_APP_ID") {
    return <>{children}</>;
  }

  return (
    <PrivySDKProvider
      appId={PRIVY_APP_ID}
      config={{
        embedded: {
          solana: {
            createOnLogin: "all-users",
          },
        },
      }}
    >
      <AuthStateSync>{children}</AuthStateSync>
    </PrivySDKProvider>
  );
}

// ─── Hook: useAuth (convenience re-export) ──────────────────────────────────

/**
 * Convenience hook that combines Privy SDK hooks with app auth actions.
 * Use inside AuthProvider tree for login flows.
 * Falls back to no-op stubs when Privy is not available (Expo Go mode).
 */
export function useAuth() {
  if (!PRIVY_AVAILABLE || !usePrivy || !useLoginWithOAuth || !useLoginWithEmail) {
    // Privy not available — return no-op stubs for dev/Expo Go mode
    const selectedTribeId = useAuthStore((s) => s.selectedTribeId);
    const setStoreState = useAuthStore.setState;

    const login = useCallback(
      async (_provider: "google" | "apple" | "email", _email?: string) => {
        // In dev mode without Privy, simulate a successful login
        console.warn('[useAuth] Privy not available — simulating login');
        setStoreState({
          fan: {
            fanId: 'dev-fan-1',
            privyUserId: 'dev-privy-1',
            tribeId: selectedTribeId ?? 'dev-tribe',
            tribeName: 'Dev Tribe',
            macroTribe: 'Dev',
            standing: 100,
            titles: 0,
            readsCorrect: 0,
            readsTotal: 0,
            currentStreak: 0,
          },
          token: 'dev-token',
          isOnboarded: true,
        });
      },
      [selectedTribeId, setStoreState],
    );

    const submitEmailCode = useCallback(async (_code: string) => {
      // no-op in dev mode
    }, []);

    return {
      user: null,
      isReady: true,
      login,
      logout: () => useAuthStore.getState().logout(),
      submitEmailCode,
      oAuthState: undefined,
      emailState: undefined,
    };
  }

  const { user, isReady, getAccessToken, logout } = usePrivy();
  const { login: oAuthLogin, state: oAuthState } = useLoginWithOAuth();
  const {
    sendCode,
    loginWithCode,
    state: emailState,
  } = useLoginWithEmail();

  const selectedTribeId = useAuthStore((s) => s.selectedTribeId);
  const setStoreState = useAuthStore.setState;

  const login = useCallback(
    async (provider: "google" | "apple" | "email", email?: string) => {
      if (provider === "email") {
        if (!email) throw new Error("Email is required for email login");
        await sendCode({ email });
        return;
      }

      const privyUser = await oAuthLogin({ provider });

      if (privyUser) {
        const token = await getAccessToken();
        if (token) {
          setStoreState({ token });

          if (selectedTribeId) {
            const result = await registerFan({
              privyUserId: privyUser.id,
              tribeId: selectedTribeId,
            });

            if (result.ok) {
              setStoreState({
                fan: result.data,
                isOnboarded: true,
              });
            }
          }
        }
      }
    },
    [oAuthLogin, sendCode, getAccessToken, selectedTribeId, setStoreState],
  );

  const submitEmailCode = useCallback(
    async (code: string) => {
      const privyUser = await loginWithCode({ code });

      if (privyUser) {
        const token = await getAccessToken();
        if (token) {
          setStoreState({ token });

          if (selectedTribeId) {
            const result = await registerFan({
              privyUserId: privyUser.id,
              tribeId: selectedTribeId,
            });

            if (result.ok) {
              setStoreState({
                fan: result.data,
                isOnboarded: true,
              });
            }
          }
        }
      }
    },
    [loginWithCode, getAccessToken, selectedTribeId, setStoreState],
  );

  return {
    user,
    isReady,
    login,
    logout,
    submitEmailCode,
    oAuthState,
    emailState,
  };
}

export default AuthProvider;

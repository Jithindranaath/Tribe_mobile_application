/**
 * Mock for @privy-io/expo when running in Expo Go.
 * 
 * @privy-io/expo requires native modules (expo-apple-authentication,
 * react-native-passkeys, etc.) that aren't available in Expo Go.
 * This mock provides no-op implementations so the app can run without
 * Privy for development and testing.
 *
 * For production builds, remove this mock from metro.config.js and use
 * a development build (npx expo run:android / npx expo run:ios) or EAS Build.
 */

const React = require("react");

// Mock PrivyProvider — just renders children
function PrivyProvider({ children }) {
  return children;
}

// Mock usePrivy hook
function usePrivy() {
  return {
    user: null,
    isReady: true,
    getAccessToken: async () => null,
    logout: async () => {},
    authenticated: false,
  };
}

// Mock useLoginWithOAuth
function useLoginWithOAuth() {
  return {
    login: async () => null,
    state: { status: "initial" },
  };
}

// Mock useLoginWithEmail
function useLoginWithEmail() {
  return {
    sendCode: async () => {},
    loginWithCode: async () => null,
    state: { status: "initial" },
  };
}

module.exports = {
  PrivyProvider,
  usePrivy,
  useLoginWithOAuth,
  useLoginWithEmail,
};

const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Some of @privy-io/expo's own dependencies (jose, viem) publish an
// "exports" map with a "browser" condition for their non-Node runtime build,
// but no "react-native" condition — Metro's exports-conditions resolution
// doesn't include "browser" by default, so without this it falls through to
// their Node-specific build, which imports Node core modules (e.g. jose's
// zlib import) that don't exist in React Native's JS runtime.
config.resolver.unstable_conditionNames = ["react-native", "browser", "require", "import"];

// @privy-io/expo needs native modules that don't exist in Expo Go — this
// project now runs via a native dev-client build (npx expo run:android /
// npx expo run:ios), which does have them, so the real library is used.
// lib/privy-mock.js is kept in the repo for anyone who needs to fall back to
// Expo Go for quick UI-only iteration; see its header comment to re-enable.
module.exports = withNativeWind(config, { input: "./global.css" });

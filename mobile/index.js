// Custom entry point (see package.json's "main") so this polyfill runs
// before absolutely anything else — including expo-router's own bootstrap,
// which eagerly imports route modules (and therefore AuthProvider, and
// therefore @privy-io/expo's dependencies jose/viem/@noble/*, which expect
// a global `crypto.getRandomValues`) before app/_layout.tsx's own body runs.
// Putting the same import at the top of _layout.tsx was too late.
import "react-native-get-random-values";
import "expo-router/entry";

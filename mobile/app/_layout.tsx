// NativeWind v4 needs this imported somewhere the bundler actually sees, not
// just referenced as metro.config.js's withNativeWind `input` option — that
// only wires the build-time babel/metro pipeline. Without this import, the
// generated Tailwind styles never get registered into NativeWind's runtime
// style resolver, so every `className` prop anywhere in the app silently
// resolves to nothing (no error — screens using className just render
// completely unstyled, which is exactly what standings/legacy/profile.tsx
// were doing; onboarding/campfire/_layout.tsx never hit this because they
// happen to use plain StyleSheet instead of className).
import "../global.css";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import "react-native-reanimated";
import { AuthProvider } from "../providers/AuthProvider";
import { ThemeProvider, useTheme } from "../providers/ThemeProvider";
// TEMPORARY — live-demo testing only, remove before shipping. Injects a real
// (already server-registered) fan session directly into useAuthStore so the
// Campfire WebSocket has a real, non-empty tribeId without needing to
// complete a real Privy OTP/OAuth flow in this environment.
import { useAuthStore } from "../stores/useAuthStore";

export { ErrorBoundary } from "expo-router";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const { isDark } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: isDark ? "#002b36" : "#fdf6e3" }]}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(main)" />
        <Stack.Screen
          name="(match)"
          options={{ presentation: "modal" }}
        />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  useEffect(() => {
    if (error) {
      console.warn("Font loading error:", error);
    }
  }, [error]);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  // TEMPORARY — see import comment above. Was flipped on to skip onboarding
  // while recording the demo video; reverted now that recording is done.
  const DEV_AUTO_LOGIN = false;
  useEffect(() => {
    if (!DEV_AUTO_LOGIN) return;
    useAuthStore.setState({
      fan: {
        fanId: "fd852897-e431-4dbe-9f22-0c09ffb67f23",
        privyUserId: "demo-live-test-user",
        tribeId: "argentina-argentina-hyderabad",
        tribeName: "Argentina · Hyderabad",
        macroTribe: "Argentina",
        standing: 100,
        titles: 0,
        readsCorrect: 0,
        readsTotal: 0,
        currentStreak: 0,
      },
      token: "demo-live-test-token",
      isOnboarded: true,
    });
  }, []);

  if (!loaded && !error) {
    return null;
  }

  return (
    <AuthProvider>
      <ThemeProvider>
        <RootLayoutNav />
      </ThemeProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

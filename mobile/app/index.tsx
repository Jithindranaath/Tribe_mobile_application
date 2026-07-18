import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useAuthStore } from "../stores/useAuthStore";

/**
 * Splash / Auth Gate
 *
 * Displays TRIBE branding and loading indicator while checking authentication state.
 * Routes to onboarding if unauthenticated, or main campfire tabs if authenticated and onboarded.
 *
 * Requirements: 1.5 (splash with TRIBE logo), 2.6 (navigate to campfire on onboarding complete)
 */
export default function SplashAuthGate() {
  const router = useRouter();
  const fan = useAuthStore((s) => s.fan);
  const isOnboarded = useAuthStore((s) => s.isOnboarded);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    // Short delay to display splash branding and allow Privy SDK to hydrate
    const timer = setTimeout(() => {
      if (fan !== null && isOnboarded) {
        router.replace("/(main)/campfire");
      } else {
        router.replace("/(auth)/onboarding");
      }
      setIsChecking(false);
    }, 750);

    return () => clearTimeout(timer);
  }, [fan, isOnboarded, router]);

  return (
    <View style={styles.container}>
      {/* TRIBE Logo / Branding */}
      <Text style={styles.title}>TRIBE</Text>
      <Text style={styles.subtitle}>Read the game. Rise together.</Text>

      {/* Loading indicator while auth check is in progress */}
      {isChecking && <ActivityIndicator size="large" color="#FF6B35" />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#002b36",
  },
  title: {
    fontSize: 48,
    fontWeight: "bold",
    color: "#ffffff",
    letterSpacing: 4,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#93a1a1",
    marginBottom: 40,
  },
});

import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useCampfireStore } from "../../stores/useCampfireStore";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Animation timing constants
const SCALE_UP_DURATION = 300;
const HOLD_DURATION = 2500;
const FADE_OUT_DURATION = 700;
const TOTAL_DURATION = SCALE_UP_DURATION + HOLD_DURATION + FADE_OUT_DURATION; // 3500ms

/**
 * SurgeOverlay — full-screen golden celebration overlay triggered when a fan's
 * Read prediction resolves correctly.
 *
 * Animation sequence (runs on native UI thread at 60fps):
 *   1. Scale-up: 0 → 1.2 over 300ms
 *   2. Hold at 1.0 for 2500ms
 *   3. Fade-out over 700ms
 *
 * After auto-dismiss (3500ms total), calls dismissSurge() from the store.
 *
 * Requirement 6.1: Display full-screen golden overlay with Standing points earned
 * Requirement 6.2: Trigger heavy impact haptic
 * Requirement 6.3: Auto-dismiss after 3500ms
 * Requirement 6.4: After dismiss, display share prompt (handled via dismissSurge flow)
 * Requirement 6.5: Play surge animation at 60fps using react-native-reanimated on native UI thread
 * Requirement 14.1: All Campfire animations at 60fps on native UI thread
 */
export function SurgeOverlay() {
  const surgeActive = useCampfireStore((s) => s.surgeActive);
  const surgePayload = useCampfireStore((s) => s.surgePayload);
  const dismissSurge = useCampfireStore((s) => s.dismissSurge);

  // Shared values for animation — run on UI thread
  const contentScale = useSharedValue(0);
  const overlayOpacity = useSharedValue(0);

  // Ref to track if we've already triggered for this surge
  const hasTriggeredRef = useRef(false);

  useEffect(() => {
    if (surgeActive && surgePayload && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true;

      // Trigger heavy impact haptic immediately
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      // Start overlay fade-in immediately
      overlayOpacity.value = withSequence(
        withTiming(1, { duration: SCALE_UP_DURATION, easing: Easing.out(Easing.cubic) }),
        // Hold at full opacity for the hold duration
        withTiming(1, { duration: HOLD_DURATION }),
        // Fade out
        withTiming(0, { duration: FADE_OUT_DURATION, easing: Easing.in(Easing.cubic) })
      );

      // Content scale animation: 0 → 1.2 (scale up) → 1.0 (settle) → stays at 1.0
      contentScale.value = withSequence(
        // Scale up from 0 to 1.2
        withTiming(1.2, { duration: SCALE_UP_DURATION, easing: Easing.out(Easing.back(1.5)) }),
        // Settle to 1.0 quickly
        withTiming(1.0, { duration: 150, easing: Easing.out(Easing.cubic) }),
        // Hold at 1.0 for the remaining hold duration
        withTiming(1.0, { duration: HOLD_DURATION - 150 }),
        // Scale down slightly during fade-out
        withTiming(0.9, { duration: FADE_OUT_DURATION, easing: Easing.in(Easing.cubic) })
      );

      // Auto-dismiss after total duration
      const dismissTimer = setTimeout(() => {
        dismissSurge();
      }, TOTAL_DURATION);

      return () => clearTimeout(dismissTimer);
    }

    if (!surgeActive) {
      // Reset for next surge
      hasTriggeredRef.current = false;
      contentScale.value = 0;
      overlayOpacity.value = 0;
    }
  }, [surgeActive, surgePayload, contentScale, overlayOpacity, dismissSurge]);

  // Animated styles — worklets run on UI thread at 60fps
  const overlayAnimatedStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      opacity: overlayOpacity.value,
    };
  });

  const contentAnimatedStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: contentScale.value }],
    };
  });

  // Don't render if surge is not active
  if (!surgeActive || !surgePayload) {
    return null;
  }

  return (
    <Animated.View style={[styles.overlay, overlayAnimatedStyle]} pointerEvents="none">
      {/* Golden gradient background */}
      <View style={styles.gradientBackground} />

      {/* Decorative ring bursts */}
      <View style={styles.ringsContainer}>
        <View style={[styles.ring, styles.ringOuter]} />
        <View style={[styles.ring, styles.ringMiddle]} />
        <View style={[styles.ring, styles.ringInner]} />
      </View>

      {/* Central content */}
      <Animated.View style={[styles.contentContainer, contentAnimatedStyle]}>
        {/* Points earned — prominent display */}
        <Text style={styles.pointsText}>
          +{surgePayload.standingEarned}
        </Text>
        <Text style={styles.standingLabel}>Standing</Text>

        {/* Surge message */}
        <Text style={styles.messageText}>
          {surgePayload.message || "CALLED IT"}
        </Text>

        {/* New total standing */}
        <Text style={styles.newStandingText}>
          Total: {surgePayload.newStanding}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    justifyContent: "center",
    alignItems: "center",
  },
  gradientBackground: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(212, 160, 23, 0.85)", // tribe-gold with opacity
  },
  ringsContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  ring: {
    position: "absolute",
    borderRadius: 9999,
    borderWidth: 2,
  },
  ringOuter: {
    width: SCREEN_WIDTH * 0.9,
    height: SCREEN_WIDTH * 0.9,
    borderColor: "rgba(255, 215, 0, 0.3)", // gold-bright faint
  },
  ringMiddle: {
    width: SCREEN_WIDTH * 0.65,
    height: SCREEN_WIDTH * 0.65,
    borderColor: "rgba(255, 215, 0, 0.5)", // gold-bright medium
  },
  ringInner: {
    width: SCREEN_WIDTH * 0.4,
    height: SCREEN_WIDTH * 0.4,
    borderColor: "rgba(255, 215, 0, 0.7)", // gold-bright strong
  },
  contentContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  pointsText: {
    fontSize: 72,
    fontWeight: "900",
    color: "#FFFFFF",
    textShadowColor: "rgba(0, 0, 0, 0.3)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  standingLabel: {
    fontSize: 24,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.9)",
    marginTop: 4,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  messageText: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
    marginTop: 24,
    textAlign: "center",
    textShadowColor: "rgba(0, 0, 0, 0.2)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  newStandingText: {
    fontSize: 16,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.75)",
    marginTop: 12,
  },
});

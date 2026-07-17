import { View, Text } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useEffect } from "react";
import { useCampfireStore } from "../../stores/useCampfireStore";

/**
 * ConvictionPulse — animated ring showing the percentage of tribe members
 * committed to the active Read. The ring scales (1.0 → 1.5) and adjusts
 * opacity based on the conviction percentage value.
 *
 * Uses react-native-reanimated with useSharedValue + withTiming for
 * scale/opacity animations running on the native UI thread at 60fps.
 *
 * Requirement 3.4: THE Campfire screen SHALL display the Conviction_Pulse
 * as an animated ring using react-native-reanimated, showing the percentage
 * of tribe members committed to the active Read.
 *
 * Requirement 14.1: All animations at 60fps on native UI thread.
 */
export function ConvictionPulse() {
  const conviction = useCampfireStore((s) => s.conviction);

  const percentage = conviction?.percentage ?? 0;

  // Shared values for ring animation
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0.3);

  // Animate ring scale/opacity when conviction percentage changes
  useEffect(() => {
    // Scale: 1.0 at 0% → 1.5 at 100%
    const targetScale = 1 + (percentage / 100) * 0.5;
    // Opacity: 0.3 at 0% → 1.0 at 100%
    const targetOpacity = 0.3 + (percentage / 100) * 0.7;

    ringScale.value = withTiming(targetScale, {
      duration: 600,
      easing: Easing.out(Easing.cubic),
    });
    ringOpacity.value = withTiming(targetOpacity, {
      duration: 600,
      easing: Easing.out(Easing.cubic),
    });
  }, [percentage, ringScale, ringOpacity]);

  // Worklet-based animated style — runs on UI thread
  const ringAnimatedStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: ringScale.value }],
      opacity: ringOpacity.value,
    };
  });

  return (
    <View className="items-center justify-center">
      {/* Animated ring */}
      <Animated.View
        style={[
          {
            width: 160,
            height: 160,
            borderRadius: 80,
            borderWidth: 3,
            borderColor: "#FF6B35", // tribe-flame
          },
          ringAnimatedStyle,
        ]}
        className="items-center justify-center"
      >
        {/* Percentage text inside ring */}
        <Text className="text-tribe-flame text-2xl font-bold">
          {percentage}%
        </Text>
        <Text className="text-dark-text text-xs mt-1">committed</Text>
      </Animated.View>
    </View>
  );
}

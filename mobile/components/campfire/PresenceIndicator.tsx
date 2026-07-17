import { View, Text } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useEffect } from "react";
import { useCampfireStore } from "../../stores/useCampfireStore";

/**
 * PresenceIndicator — shows the count of currently active tribe members
 * with a breathing/pulsing green dot animation that scales between 0.8 and 1.2.
 *
 * Uses react-native-reanimated withRepeat(withTiming(...)) for the breathing
 * animation running on the native UI thread at 60fps.
 *
 * Requirement 3.5: THE Campfire screen SHALL display the Presence_Indicator
 * showing the count of currently active tribe members with a breathing dot animation.
 *
 * Requirement 14.1: All animations at 60fps on native UI thread.
 */
export function PresenceIndicator() {
  const presence = useCampfireStore((s) => s.presence);

  const activeCount = presence?.activeCount ?? 0;

  // Shared value for breathing dot scale animation
  const dotScale = useSharedValue(0.8);

  // Start the breathing animation on mount
  useEffect(() => {
    dotScale.value = withRepeat(
      withTiming(1.2, {
        duration: 1200,
        easing: Easing.inOut(Easing.ease),
      }),
      -1, // infinite repeat
      true // reverse (oscillate between 0.8 and 1.2)
    );
  }, [dotScale]);

  // Worklet-based animated style — runs on UI thread
  const dotAnimatedStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: dotScale.value }],
    };
  });

  return (
    <View className="flex-row items-center gap-2">
      {/* Breathing green dot */}
      <Animated.View
        style={[
          {
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: "#859900", // solar-green
          },
          dotAnimatedStyle,
        ]}
      />

      {/* Active member count */}
      <Text className="text-dark-text text-sm font-medium">
        {activeCount} active
      </Text>
    </View>
  );
}

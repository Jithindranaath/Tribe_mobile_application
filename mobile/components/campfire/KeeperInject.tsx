import { useEffect, useRef } from "react";
import { Text } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  Easing,
} from "react-native-reanimated";
import { useCampfireStore } from "../../stores/useCampfireStore";
import type { KeeperInjectPayload } from "../../types";

/**
 * Emotion → color mapping for Keeper messages.
 * neutral=#839496, tense=#dc322f, euphoric=#d4a017, dramatic=#6c71c4
 */
const EMOTION_COLORS: Record<KeeperInjectPayload["emotion"], string> = {
  neutral: "#839496",
  tense: "#dc322f",
  euphoric: "#d4a017",
  dramatic: "#6c71c4",
};

const DISPLAY_DURATION_MS = 4000;
const FADE_IN_MS = 400;
const FADE_OUT_MS = 600;

/**
 * KeeperInject — floating text overlay displayed when the Keeper emits a message.
 *
 * Appears with a fade-in animation, stays visible for ~4 seconds, then fades out.
 * Text color is determined by the emotion context of the message.
 *
 * Uses react-native-reanimated for smooth fade-in/out on the native UI thread.
 *
 * Requirement 3.8: WHEN the Keeper emits a message, THE Campfire screen SHALL
 * display a floating text overlay with the Keeper's inject message and emotion context.
 */
export function KeeperInject() {
  const keeperMessage = useCampfireStore((s) => s.keeperMessage);
  const opacity = useSharedValue(0);
  const lastMessageRef = useRef<string | null>(null);

  useEffect(() => {
    if (!keeperMessage) {
      // Fade out if message cleared externally
      opacity.value = withTiming(0, { duration: FADE_OUT_MS });
      return;
    }

    // Avoid replaying the same message
    const messageKey = `${keeperMessage.message}_${keeperMessage.emotion}`;
    if (messageKey === lastMessageRef.current) return;
    lastMessageRef.current = messageKey;

    // Fade-in → hold → fade-out sequence
    opacity.value = withSequence(
      withTiming(1, { duration: FADE_IN_MS, easing: Easing.out(Easing.ease) }),
      withDelay(
        DISPLAY_DURATION_MS,
        withTiming(0, { duration: FADE_OUT_MS, easing: Easing.in(Easing.ease) })
      )
    );

    // Clear the store after full animation completes
    const totalDuration = FADE_IN_MS + DISPLAY_DURATION_MS + FADE_OUT_MS;
    const timer = setTimeout(() => {
      useCampfireStore.setState({ keeperMessage: null });
      lastMessageRef.current = null;
    }, totalDuration);

    return () => clearTimeout(timer);
  }, [keeperMessage, opacity]);

  const animatedStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      opacity: opacity.value,
    };
  });

  if (!keeperMessage) return null;

  const textColor = EMOTION_COLORS[keeperMessage.emotion] ?? EMOTION_COLORS.neutral;

  return (
    <Animated.View
      style={animatedStyle}
      className="absolute top-24 left-0 right-0 items-center px-6 z-40"
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLabel={`Keeper says: ${keeperMessage.message}`}
    >
      <Text
        style={{ color: textColor }}
        className="text-base font-light italic text-center"
      >
        {keeperMessage.message}
      </Text>
    </Animated.View>
  );
}

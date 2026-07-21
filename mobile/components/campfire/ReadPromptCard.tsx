import { useEffect, useState, useRef, useCallback } from "react";
import { View, Text, Pressable, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useCampfireStore } from "../../stores/useCampfireStore";
import { useAuthStore } from "../../stores/useAuthStore";
import { commitReadWithFallback } from "../../lib/api";

const SCREEN_HEIGHT = Dimensions.get("window").height;
const CARD_HEIGHT = 280;
const VISIBLE_POSITION = 0;
const HIDDEN_POSITION = SCREEN_HEIGHT;

/**
 * ReadPromptCard — slides up from the bottom of the screen when the Keeper
 * surfaces a Read_Prompt. Displays the prediction question, YES/NO buttons,
 * difficulty multiplier, and a countdown timer.
 *
 * - Auto-dismisses when countdown reaches zero (Requirement 3.7)
 * - Prevents duplicate commits via committedReadIds (Requirement 5.4)
 * - Sends commit with haptic feedback on YES/NO tap (Requirements 5.1, 5.2)
 * - Shows "Awaiting resolution" after commit (Requirement 5.3)
 *
 * Requirements: 3.6, 3.7, 5.1, 5.2, 5.3, 5.4
 */
export function ReadPromptCard() {
  const activePrompt = useCampfireStore((s) => s.activePrompt);
  const committedReadIds = useCampfireStore((s) => s.committedReadIds);
  const commitRead = useCampfireStore((s) => s.commitRead);
  const dismissPrompt = useCampfireStore((s) => s.dismissPrompt);
  const fan = useAuthStore((s) => s.fan);

  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [hasCommitted, setHasCommitted] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const translateY = useSharedValue(HIDDEN_POSITION);

  // Determine if this prompt was already committed (duplicate prevention)
  const isAlreadyCommitted = activePrompt
    ? committedReadIds.has(activePrompt.readId)
    : false;

  // Slide animation style — worklet runs on UI thread
  const animatedStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  // Slide in/out when activePrompt changes
  useEffect(() => {
    if (activePrompt) {
      // Reset local committed state for new prompt
      setHasCommitted(false);
      // Check if already committed before showing buttons
      if (committedReadIds.has(activePrompt.readId)) {
        setHasCommitted(true);
      }
      // Slide up
      translateY.value = withSpring(VISIBLE_POSITION, {
        damping: 20,
        stiffness: 150,
      });
    } else {
      // Slide down
      translateY.value = withSpring(HIDDEN_POSITION, {
        damping: 20,
        stiffness: 150,
      });
    }
  }, [activePrompt, committedReadIds, translateY]);

  // Countdown timer logic
  useEffect(() => {
    if (!activePrompt) {
      // Clear interval when prompt is gone
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Calculate initial remaining time
    const calcRemaining = () =>
      Math.max(0, Math.ceil((activePrompt.expiresAt - Date.now()) / 1000));

    setRemainingSeconds(calcRemaining());

    intervalRef.current = setInterval(() => {
      const remaining = calcRemaining();
      setRemainingSeconds(remaining);

      if (remaining <= 0) {
        // Auto-dismiss when timer reaches zero
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        dismissPrompt();
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [activePrompt, dismissPrompt]);

  // Handle YES/NO tap
  const handleCommit = useCallback(
    (predicted: number) => {
      if (!activePrompt || !fan) return;

      // Prevent duplicate commits
      if (committedReadIds.has(activePrompt.readId)) return;

      // Local optimistic UI update (pending-read indicator, dedup tracking)
      commitRead(activePrompt.readId, predicted);

      // The real commit — WS-first with REST fallback. Previously this
      // never happened at all: commitRead() above only ever touched local
      // state, so no prediction a fan made was ever recorded server-side.
      const { fixtureId, wsSendReadCommit } = useCampfireStore.getState();
      commitReadWithFallback(
        activePrompt.readId,
        predicted,
        fan.fanId,
        Number(fixtureId),
        activePrompt.readType,
        activePrompt.multiplier,
        wsSendReadCommit ?? undefined,
      ).catch((error) => {
        console.error("[ReadPromptCard] Failed to commit read:", error);
      });

      // Trigger medium haptic feedback
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Show awaiting state
      setHasCommitted(true);
    },
    [activePrompt, committedReadIds, commitRead, fan]
  );

  // Don't render anything if no active prompt
  if (!activePrompt) return null;

  const showAwaitingState = hasCommitted || isAlreadyCommitted;

  return (
    <Animated.View
      style={animatedStyle}
      className="absolute bottom-0 left-0 right-0 z-50"
    >
      <View className="mx-4 mb-8 rounded-2xl bg-dark-surface border border-dark-border p-5">
        {/* Multiplier badge */}
        <View className="flex-row items-center justify-between mb-3">
          <View className="bg-tribe-flame/20 rounded-full px-3 py-1">
            <Text className="text-tribe-flame text-xs font-bold">
              {activePrompt.multiplier}x
            </Text>
          </View>

          {/* Countdown timer */}
          <View className="flex-row items-center">
            <Text
              className={`text-sm font-semibold ${
                remainingSeconds <= 5 ? "text-solar-red" : "text-dark-text"
              }`}
            >
              {remainingSeconds}s
            </Text>
          </View>
        </View>

        {/* Question text */}
        <Text className="text-dark-text-emphasis text-lg font-semibold text-center mb-5">
          {activePrompt.question}
        </Text>

        {/* Action area */}
        {showAwaitingState ? (
          // Awaiting resolution state
          <View className="items-center py-4">
            <Text className="text-tribe-gold text-base font-semibold">
              Awaiting resolution
            </Text>
          </View>
        ) : (
          // YES / NO buttons
          <View className="flex-row justify-center gap-4">
            <Pressable
              onPress={() => handleCommit(1)}
              className="flex-1 bg-tribe-flame rounded-xl py-4 items-center active:opacity-80"
            >
              <Text className="text-white text-base font-bold">YES</Text>
            </Pressable>

            <Pressable
              onPress={() => handleCommit(0)}
              className="flex-1 bg-dark-border rounded-xl py-4 items-center active:opacity-80"
            >
              <Text className="text-dark-text-emphasis text-base font-bold">
                NO
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

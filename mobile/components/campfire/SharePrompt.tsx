import { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useCampfireStore } from "../../stores/useCampfireStore";

// Auto-dismiss after 10 seconds if no action
const AUTO_DISMISS_MS = 10_000;

/**
 * SharePrompt — floating prompt that appears after Surge dismisses.
 * Downloads the server-rendered Share_Card image (1080×1920 Instagram Story format)
 * and opens the native share sheet via expo-sharing.
 *
 * Requirement 8.1: Download server-rendered image from share_card_ready event URL
 * Requirement 8.2: Open native share sheet via expo-sharing with Share_Card image
 * Requirement 8.3: Share_Card in Instagram Story format (1080×1920)
 */
export function SharePrompt() {
  const shareCard = useCampfireStore((s) => s.shareCard);
  const surgeActive = useCampfireStore((s) => s.surgeActive);

  const [localFilePath, setLocalFilePath] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Animation: slide-up from bottom
  const translateY = useSharedValue(100);
  const opacity = useSharedValue(0);

  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Determine visibility: shareCard present AND surge NOT active (appears after surge dismiss)
  const visible = shareCard !== null && !surgeActive;

  // Clear shareCard from store
  const clearShareCard = useCallback(() => {
    useCampfireStore.setState({ shareCard: null });
  }, []);

  // Download image from server URL to local temp file
  useEffect(() => {
    if (!shareCard?.imageUrl) {
      setLocalFilePath(null);
      return;
    }

    let cancelled = false;
    setIsDownloading(true);
    setError(null);

    const downloadImage = async () => {
      try {
        const destination = new File(Paths.cache, `share_card_${shareCard.cardId}.png`);

        const downloadedFile = await File.downloadFileAsync(
          shareCard.imageUrl,
          destination,
          { idempotent: true }
        );

        if (!cancelled) {
          setLocalFilePath(downloadedFile.uri);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Could not download share card");
        }
      } finally {
        if (!cancelled) {
          setIsDownloading(false);
        }
      }
    };

    downloadImage();

    return () => {
      cancelled = true;
    };
  }, [shareCard?.imageUrl, shareCard?.cardId]);

  // Animate in/out based on visibility
  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, { damping: 18, stiffness: 120 });
      opacity.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });

      // Auto-dismiss after timeout
      dismissTimerRef.current = setTimeout(() => {
        handleDismiss();
      }, AUTO_DISMISS_MS);
    } else {
      translateY.value = withTiming(100, { duration: 200 });
      opacity.value = withTiming(0, { duration: 200 });
    }

    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [visible]);

  // Share action — open native share sheet
  const handleShare = async () => {
    if (!localFilePath) return;

    const isSharingAvailable = await Sharing.isAvailableAsync();
    if (!isSharingAvailable) {
      setError("Sharing not available on this device");
      return;
    }

    setIsSharing(true);
    try {
      await Sharing.shareAsync(localFilePath, {
        mimeType: "image/png",
        dialogTitle: "Share Your Call",
      });
    } catch {
      // User may have cancelled share sheet — that's fine
    } finally {
      setIsSharing(false);
      clearShareCard();
    }
  };

  // Dismiss without sharing
  const handleDismiss = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    clearShareCard();
  };

  // Animated styles
  const animatedContainerStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ translateY: translateY.value }],
      opacity: opacity.value,
    };
  });

  // Don't render anything if no share card
  if (!shareCard) return null;

  return (
    <Animated.View
      style={animatedContainerStyle}
      className="absolute bottom-6 left-4 right-4 z-40"
      pointerEvents={visible ? "auto" : "none"}
    >
      <View className="flex-row items-center gap-3 rounded-2xl bg-dark-surface/90 border border-dark-border/30 p-3 shadow-lg">
        {/* Thumbnail preview placeholder */}
        <View className="h-14 w-10 rounded-lg bg-tribe-coal items-center justify-center overflow-hidden">
          {isDownloading ? (
            <ActivityIndicator size="small" color="#839496" />
          ) : (
            <Text className="text-lg">🃏</Text>
          )}
        </View>

        {/* Text content */}
        <View className="flex-1">
          <Text className="text-sm font-semibold text-dark-text-emphasis">
            Share Your Call
          </Text>
          <Text className="text-xs text-dark-text opacity-60">
            {error
              ? error
              : isDownloading
              ? "Preparing card..."
              : "Show your tribe what you called"}
          </Text>
        </View>

        {/* Share button */}
        <Pressable
          onPress={handleShare}
          disabled={isDownloading || isSharing || !!error}
          className="rounded-full bg-tribe-flame px-4 py-2 active:opacity-80"
          accessibilityLabel="Share your call"
          accessibilityRole="button"
        >
          {isSharing ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text className="text-xs font-bold text-white">Share</Text>
          )}
        </Pressable>

        {/* Dismiss button */}
        <Pressable
          onPress={handleDismiss}
          className="ml-1 h-6 w-6 items-center justify-center rounded-full"
          accessibilityLabel="Dismiss share prompt"
          accessibilityRole="button"
        >
          <Text className="text-dark-text opacity-50 text-sm">✕</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

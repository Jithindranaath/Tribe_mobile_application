import { View, Text, Pressable } from "react-native";

/**
 * Props for OfflineIndicator.
 * `retry` comes from the useCampfireSocket hook's return value.
 * `isOffline` indicates the connection has failed after 4 reconnect attempts.
 */
interface OfflineIndicatorProps {
  isOffline: boolean;
  retry: () => void;
}

/**
 * OfflineIndicator — red/warning bar displayed at the top of the Campfire
 * screen when the WebSocket connection is lost after 4 failed reconnection attempts.
 *
 * Shows "Connection lost" message with a manual "Retry" button.
 *
 * Requirement 4.5: IF the WebSocket connection fails after 4 reconnection attempts,
 * THEN THE Mobile_App SHALL display an offline indicator and offer a manual
 * reconnect option.
 */
export function OfflineIndicator({ isOffline, retry }: OfflineIndicatorProps) {
  if (!isOffline) return null;

  return (
    <View
      className="mx-4 mt-2 px-4 py-3 rounded-lg bg-solar-red/15 border border-solar-red/40 flex-row items-center justify-between"
      accessibilityRole="alert"
      accessibilityLabel="Connection lost. Tap retry to reconnect."
    >
      <View className="flex-row items-center gap-2 flex-1">
        {/* Warning dot */}
        <View className="w-2.5 h-2.5 rounded-full bg-solar-red" />

        {/* Message */}
        <Text className="text-solar-red text-sm font-medium">
          Connection lost
        </Text>
      </View>

      {/* Retry button */}
      <Pressable
        onPress={retry}
        className="bg-solar-red/20 rounded-md px-3 py-1.5 active:opacity-70"
        accessibilityRole="button"
        accessibilityLabel="Retry connection"
      >
        <Text className="text-solar-red text-xs font-bold">Retry</Text>
      </Pressable>
    </View>
  );
}

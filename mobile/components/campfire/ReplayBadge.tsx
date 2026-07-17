import { View, Text } from "react-native";

/**
 * ReplayBadge — small floating "REPLAY" label displayed at the top of the
 * Campfire screen when the fan is watching a historical match replay.
 *
 * Requirement 11.3: WHILE in Replay_Mode, THE Campfire screen SHALL display
 * a "REPLAY" badge to distinguish the experience from live matches.
 */
export function ReplayBadge() {
  return (
    <View className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
      <View className="bg-solar-violet/90 rounded-full px-4 py-1.5 shadow-lg">
        <Text className="text-white text-xs font-bold tracking-widest uppercase">
          REPLAY
        </Text>
      </View>
    </View>
  );
}

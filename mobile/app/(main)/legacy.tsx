import { View, Text } from "react-native";
import { useEffect, useCallback } from "react";
import { useTimelineStore } from "../../stores/useTimelineStore";
import { useAuthStore } from "../../stores/useAuthStore";
import { TimelineList } from "../../components/legacy/TimelineList";

/**
 * Legacy Screen
 *
 * Displays the fan's timeline of moments (successful reads, titles earned,
 * rank climbs) and a Wrapped preview card summarizing tournament stats.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 14.2
 */
export default function LegacyScreen() {
  const fan = useAuthStore((s) => s.fan);
  const moments = useTimelineStore((s) => s.moments);
  const wrappedStats = useTimelineStore((s) => s.wrappedStats);
  const isLoading = useTimelineStore((s) => s.isLoading);
  const fetchTimeline = useTimelineStore((s) => s.fetchTimeline);

  // Fetch timeline on mount
  useEffect(() => {
    if (fan) {
      fetchTimeline();
    }
  }, [fan, fetchTimeline]);

  const handleRefresh = useCallback(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  return (
    <View className="flex-1 bg-dark-bg pt-12">
      {/* Screen header */}
      <View className="px-4 pb-4">
        <Text className="text-dark-text-emphasis text-2xl font-bold">
          📖 Legacy
        </Text>
        <Text className="text-dark-text text-sm mt-1">
          Your journey through the tournament
        </Text>
      </View>

      {/* Timeline with Wrapped preview and moment cards */}
      <TimelineList
        moments={moments}
        wrappedStats={wrappedStats}
        isLoading={isLoading}
        onRefresh={handleRefresh}
      />
    </View>
  );
}

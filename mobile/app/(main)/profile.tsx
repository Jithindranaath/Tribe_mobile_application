import { useEffect } from "react";
import { View, Text, ScrollView } from "react-native";
import { useAuthStore, useTimelineStore } from "../../stores";
import { StandingGraph } from "../../components/profile/StandingGraph";
import { TitleBadge } from "../../components/profile/TitleBadge";
import { StatsGrid } from "../../components/profile/StatsGrid";
import { SettingsSection } from "../../components/profile/SettingsSection";

/**
 * Profile Screen
 *
 * Displays the fan's tribe membership, standing history graph,
 * earned title badges, stats grid, and settings.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4
 */
export default function ProfileScreen() {
  const fan = useAuthStore((s) => s.fan);
  const standingHistory = useTimelineStore((s) => s.standingHistory);
  const wrappedStats = useTimelineStore((s) => s.wrappedStats);
  const fetchTimeline = useTimelineStore((s) => s.fetchTimeline);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  if (!fan) {
    return (
      <View className="flex-1 items-center justify-center bg-dark-bg">
        <Text className="text-dark-text text-sm">
          Sign in to view your profile
        </Text>
      </View>
    );
  }

  // fan.standing is a snapshot from login/registration and never refreshes —
  // the real standingHistory (fetched fresh above) is authoritative once
  // loaded, so prefer its most recent point.
  const currentStanding =
    standingHistory.length > 0 ? standingHistory[standingHistory.length - 1] : fan.standing;

  return (
    <ScrollView
      className="flex-1 bg-dark-bg"
      contentContainerClassName="px-4 pt-12 pb-8"
      showsVerticalScrollIndicator={false}
    >
      {/* Profile header — tribe membership and standing */}
      <View className="items-center mb-6">
        <View className="w-16 h-16 rounded-full bg-dark-surface items-center justify-center mb-3">
          <Text className="text-2xl">👤</Text>
        </View>
        <Text className="text-dark-text-emphasis text-lg font-bold">
          {fan.tribeName}
        </Text>
        <Text className="text-dark-text text-sm mt-1">
          {fan.macroTribe} · Standing{" "}
          <Text className="text-tribe-gold font-semibold">
            {currentStanding}
          </Text>
        </Text>
      </View>

      {/* Standing History Graph — Requirement 10.1 */}
      <StandingGraph currentStanding={currentStanding} history={standingHistory} />

      {/* Title Badges — Requirement 10.2 */}
      <TitleBadge titlesBitmask={fan.titles} />

      {/* Stats Grid — Requirement 10.3 */}
      <StatsGrid
        readsTotal={wrappedStats?.readsMade ?? 0}
        readsCorrect={wrappedStats?.readsCorrect ?? 0}
        currentStreak={wrappedStats?.currentStreak ?? 0}
      />

      {/* Settings — Requirement 10.4 */}
      <SettingsSection />
    </ScrollView>
  );
}

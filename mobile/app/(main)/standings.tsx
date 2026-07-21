import { useCallback, useEffect, useState } from "react";
import { View, Text, RefreshControl } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import { useStandingsStore, useAuthStore } from "../../stores";
import {
  StandingsSegmentControl,
  type StandingsView,
} from "../../components/standings/StandingsSegmentControl";
import { PersonalStandingCard } from "../../components/standings/PersonalStandingCard";
import { TribeRankRow } from "../../components/standings/TribeRankRow";
import type { TribeRanking } from "../../types";

/**
 * Standings Screen
 *
 * Displays tribe rankings in three views (global top 50, country-specific,
 * city-specific) with the fan's personal Standing score and a pull-to-refresh
 * mechanism fetching from GET /api/tribe/:tribeId/standings.
 *
 * Requirements: 7.1, 7.2, 7.4
 */
export default function StandingsScreen() {
  const [activeView, setActiveView] = useState<StandingsView>("global");

  // Store selectors
  const globalRankings = useStandingsStore((s) => s.globalRankings);
  const countryRankings = useStandingsStore((s) => s.countryRankings);
  const cityRankings = useStandingsStore((s) => s.cityRankings);
  const personalStanding = useStandingsStore((s) => s.personalStanding);
  const personalRank = useStandingsStore((s) => s.personalRank);
  const isLoading = useStandingsStore((s) => s.isLoading);
  const fetchStandings = useStandingsStore((s) => s.fetchStandings);

  const fan = useAuthStore((s) => s.fan);

  // Fetch on mount — previously this only happened on pull-to-refresh or a
  // segment-tab change, so the screen always opened to "No standings data
  // available" until the user manually refreshed.
  useEffect(() => {
    fetchStandings(activeView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determine which rankings list to display based on active view
  const rankings: TribeRanking[] =
    activeView === "global"
      ? globalRankings
      : activeView === "country"
        ? countryRankings
        : cityRankings;

  // Pull-to-refresh handler
  const handleRefresh = useCallback(() => {
    fetchStandings(activeView);
  }, [activeView, fetchStandings]);

  // Handle segment change — fetch new view data
  const handleViewChange = useCallback(
    (view: StandingsView) => {
      setActiveView(view);
      fetchStandings(view);
    },
    [fetchStandings],
  );

  // Render a single tribe ranking row using TribeRankRow with animated transitions
  const renderItem = useCallback(
    ({ item }: { item: TribeRanking }) => <TribeRankRow item={item} />,
    [],
  );

  const keyExtractor = useCallback(
    (item: TribeRanking) => item.tribeId,
    [],
  );

  // List header includes personal standing card and segment control
  const ListHeader = useCallback(
    () => (
      <View>
        {/* Screen title */}
        <Text className="text-white text-2xl font-bold mx-4 mb-4">
          🏆 Standings
        </Text>

        {/* Personal standing card */}
        <PersonalStandingCard
          standing={personalStanding}
          rank={personalRank}
        />

        {/* Segment control */}
        <StandingsSegmentControl
          activeView={activeView}
          onViewChange={handleViewChange}
        />
      </View>
    ),
    [personalStanding, personalRank, activeView, handleViewChange],
  );

  // Empty state
  const ListEmpty = useCallback(
    () =>
      !isLoading ? (
        <View className="items-center justify-center py-12">
          <Text className="text-dark-text text-sm">
            No standings data available.
          </Text>
          <Text className="text-dark-text text-xs mt-1">
            Pull down to refresh.
          </Text>
        </View>
      ) : null,
    [isLoading],
  );

  return (
    <View className="flex-1 bg-dark-bg pt-12">
      <Animated.FlatList
        data={rankings}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={handleRefresh}
            tintColor="#2aa198"
            colors={["#2aa198"]}
          />
        }
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews
        itemLayoutAnimation={LinearTransition.springify()}
      />
    </View>
  );
}

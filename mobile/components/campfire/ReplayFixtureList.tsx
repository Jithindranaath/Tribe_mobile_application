import { useEffect, useState, useCallback } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import type { Fixture } from "../../types";

const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * ReplayFixtureList — Displays a list of recent finished fixtures available
 * for replay when no live fixture is active.
 *
 * Fetches from GET /api/fixtures/historical and shows completed matches
 * the fan can select to enter replay mode.
 *
 * Requirement 11.1: WHEN no live fixture is available, THE Mobile_App SHALL
 * display a list of recent finished fixtures available for replay.
 */
export function ReplayFixtureList() {
  const router = useRouter();
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistoricalFixtures = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${BASE_URL}/api/fixtures/historical`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data: Fixture[] = await response.json();
      setFixtures(data.filter((f) => f.state === "finished"));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load replay fixtures"
      );
      setFixtures([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistoricalFixtures();
  }, [fetchHistoricalFixtures]);

  const handleSelectFixture = (fixtureId: number) => {
    router.push(`/(match)/replay/${fixtureId}`);
  };

  const renderFixtureItem = ({ item }: { item: Fixture }) => (
    <Pressable
      onPress={() => handleSelectFixture(item.fixtureId)}
      className="bg-dark-surface rounded-xl p-4 mx-4 mb-3 border border-dark-border active:opacity-80"
    >
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-solar-cyan text-xs font-semibold uppercase tracking-wide">
          {item.league}
        </Text>
        <Text className="text-dark-text text-xs">
          {new Date(item.kickoff).toLocaleDateString()}
        </Text>
      </View>

      <View className="flex-row items-center justify-center">
        <Text
          className="text-dark-text-emphasis text-base font-semibold flex-1 text-right"
          numberOfLines={1}
        >
          {item.homeTeam}
        </Text>
        <Text className="text-tribe-flame text-lg font-bold mx-3">vs</Text>
        <Text
          className="text-dark-text-emphasis text-base font-semibold flex-1 text-left"
          numberOfLines={1}
        >
          {item.awayTeam}
        </Text>
      </View>

      <View className="items-center mt-2">
        <Text className="text-solar-violet text-xs font-medium">
          Tap to replay
        </Text>
      </View>
    </Pressable>
  );

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-dark-bg">
        <ActivityIndicator size="large" color="#6c71c4" />
        <Text className="text-dark-text mt-4">Loading replays…</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-dark-bg">
      {/* Header */}
      <View className="px-4 pt-12 pb-4">
        <Text className="text-dark-text-emphasis text-2xl font-bold">
          ⏪ Replay Mode
        </Text>
        <Text className="text-dark-text text-sm mt-1">
          Re-experience past matches and practice your Reads
        </Text>
      </View>

      {error && (
        <View className="mx-4 mb-3 bg-solar-red/10 rounded-lg px-3 py-2">
          <Text className="text-solar-red text-xs">
            Couldn't load replays • {error}
          </Text>
        </View>
      )}

      <FlatList
        data={fixtures}
        keyExtractor={(item) => String(item.fixtureId)}
        renderItem={renderFixtureItem}
        contentContainerStyle={{ paddingBottom: 24 }}
        removeClippedSubviews={true}
        maxToRenderPerBatch={8}
        windowSize={5}
        ListEmptyComponent={
          <View className="items-center justify-center py-12">
            <Text className="text-dark-text text-base">
              No replay fixtures available
            </Text>
          </View>
        }
      />
    </View>
  );
}

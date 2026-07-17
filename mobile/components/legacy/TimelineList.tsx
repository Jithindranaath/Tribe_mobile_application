import { FlatList, View, Text, RefreshControl } from "react-native";
import { useCallback } from "react";
import type { TimelineMoment, WrappedStats } from "../../types";
import { MomentCard } from "./MomentCard";
import { WrappedPreview } from "./WrappedPreview";

interface TimelineListProps {
  moments: TimelineMoment[];
  wrappedStats: WrappedStats | null;
  isLoading: boolean;
  onRefresh: () => void;
}

/**
 * TimelineList — a virtualized FlatList rendering the fan's timeline
 * of moments with the Wrapped preview card at the top.
 *
 * Uses FlatList with virtualization for smooth scrolling performance.
 *
 * Requirement 9.1: Scrollable timeline fetched from GET /api/fan/:fanId/timeline.
 * Requirement 14.2: FlatList with virtualization for smooth scrolling.
 */
export function TimelineList({
  moments,
  wrappedStats,
  isLoading,
  onRefresh,
}: TimelineListProps) {
  const renderItem = useCallback(
    ({ item }: { item: TimelineMoment }) => <MomentCard moment={item} />,
    [],
  );

  const keyExtractor = useCallback(
    (item: TimelineMoment) => item.id,
    [],
  );

  const ListHeader = useCallback(() => {
    if (!wrappedStats) return null;
    return <WrappedPreview stats={wrappedStats} />;
  }, [wrappedStats]);

  const ListEmpty = useCallback(() => {
    if (isLoading) return null;
    return (
      <View className="flex-1 items-center justify-center py-20">
        <Text className="text-dark-text text-base opacity-60">
          No moments yet
        </Text>
        <Text className="text-dark-text text-sm opacity-40 mt-2">
          Start making Reads to build your Legacy
        </Text>
      </View>
    );
  }, [isLoading]);

  return (
    <FlatList
      data={moments}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      ListHeaderComponent={ListHeader}
      ListEmptyComponent={ListEmpty}
      contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={onRefresh}
          tintColor="#839496"
          colors={["#839496"]}
        />
      }
      // Virtualization settings for performance
      removeClippedSubviews={true}
      maxToRenderPerBatch={10}
      windowSize={5}
      initialNumToRender={8}
    />
  );
}

import { memo } from "react";
import { View, Text } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import type { TribeRanking } from "../../types";

/**
 * TribeRankRow
 *
 * Displays a single tribe's rank, name, aggregate standing, member count,
 * and accuracy percentage. Shows a rank change indicator (↑ or ↓) when
 * previousRank differs from the current rank.
 *
 * Uses react-native-reanimated LinearTransition.springify() to animate
 * smooth rank transitions when the list reorders.
 *
 * Requirements: 7.3, 7.5, 14.2
 */

interface TribeRankRowProps {
  item: TribeRanking;
}

/**
 * Computes the rank change direction and magnitude.
 * A positive delta means the tribe moved UP in rank (previousRank was higher number).
 */
function getRankChange(rank: number, previousRank?: number) {
  if (previousRank == null || previousRank === rank) {
    return null;
  }
  const delta = previousRank - rank; // positive = moved up, negative = moved down
  return {
    direction: delta > 0 ? "up" : "down",
    magnitude: Math.abs(delta),
  } as const;
}

function TribeRankRowInner({ item }: TribeRankRowProps) {
  const rankChange = getRankChange(item.rank, item.previousRank);

  return (
    <Animated.View
      layout={LinearTransition.springify()}
      className="flex-row items-center bg-dark-surface rounded-xl mx-4 mb-2 p-3"
    >
      {/* Rank number */}
      <View className="w-10 items-center">
        <Text className="text-tribe-gold-bright text-base font-bold">
          {item.rank}
        </Text>
        {/* Rank change indicator */}
        {rankChange && (
          <View className="flex-row items-center mt-0.5">
            <Text
              className={`text-xs font-semibold ${
                rankChange.direction === "up"
                  ? "text-solar-green"
                  : "text-solar-red"
              }`}
            >
              {rankChange.direction === "up" ? "↑" : "↓"}
              {rankChange.magnitude}
            </Text>
          </View>
        )}
      </View>

      {/* Tribe info: name, member count, accuracy */}
      <View className="flex-1 ml-3">
        <Text className="text-dark-text-emphasis text-sm font-semibold">
          {item.tribeName}
        </Text>
        <Text className="text-dark-text text-xs mt-0.5">
          {item.memberCount} members · {item.accuracyPercentage.toFixed(1)}%
          accuracy
        </Text>
      </View>

      {/* Aggregate standing */}
      <View className="items-end">
        <Text className="text-white text-sm font-bold">
          {item.aggregateStanding}
        </Text>
        <Text className="text-dark-text text-xs">standing</Text>
      </View>
    </Animated.View>
  );
}

export const TribeRankRow = memo(TribeRankRowInner);

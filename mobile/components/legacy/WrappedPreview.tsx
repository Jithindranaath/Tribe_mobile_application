import { View, Text } from "react-native";
import type { WrappedStats } from "../../types";

interface WrappedPreviewProps {
  stats: WrappedStats;
}

/**
 * WrappedPreview — a summary card at the top of the timeline showing
 * tournament stats in a Spotify Wrapped–style presentation.
 *
 * Displays: matches watched, reads made, accuracy percentage, best call,
 * and earned titles.
 *
 * Requirement 9.3: Wrapped preview card summarizing tournament statistics.
 */
export function WrappedPreview({ stats }: WrappedPreviewProps) {
  const {
    matchesWatched,
    readsMade,
    accuracyPercentage,
    bestCall,
    earnedTitles,
    standingGained,
  } = stats;

  return (
    <View className="mx-4 mb-6 rounded-2xl overflow-hidden border border-tribe-gold/30">
      {/* Header gradient-like block */}
      <View className="bg-tribe-coal px-5 pt-5 pb-3">
        <Text className="text-tribe-gold-bright text-xs font-bold uppercase tracking-widest mb-1">
          🏆 Your Wrapped
        </Text>
        <Text className="text-dark-text-emphasis text-lg font-bold">
          World Cup 2026
        </Text>
      </View>

      {/* Stats grid */}
      <View className="bg-dark-surface px-5 py-4">
        <View className="flex-row flex-wrap justify-between">
          {/* Matches */}
          <View className="w-[48%] mb-4">
            <Text className="text-dark-text text-xs uppercase tracking-wider mb-1">
              Matches
            </Text>
            <Text className="text-dark-text-emphasis text-2xl font-bold">
              {matchesWatched}
            </Text>
          </View>

          {/* Reads */}
          <View className="w-[48%] mb-4">
            <Text className="text-dark-text text-xs uppercase tracking-wider mb-1">
              Reads
            </Text>
            <Text className="text-dark-text-emphasis text-2xl font-bold">
              {readsMade}
            </Text>
          </View>

          {/* Accuracy */}
          <View className="w-[48%] mb-4">
            <Text className="text-dark-text text-xs uppercase tracking-wider mb-1">
              Accuracy
            </Text>
            <Text className="text-solar-green text-2xl font-bold">
              {accuracyPercentage.toFixed(1)}%
            </Text>
          </View>

          {/* Standing gained */}
          <View className="w-[48%] mb-4">
            <Text className="text-dark-text text-xs uppercase tracking-wider mb-1">
              Standing Gained
            </Text>
            <Text className="text-tribe-gold text-2xl font-bold">
              +{standingGained}
            </Text>
          </View>
        </View>

        {/* Best call */}
        <View className="mt-2 mb-3 px-3 py-3 bg-solar-base03/50 rounded-xl">
          <Text className="text-dark-text text-xs uppercase tracking-wider mb-1">
            Best Call
          </Text>
          <Text className="text-dark-text-emphasis text-sm font-semibold">
            {bestCall}
          </Text>
        </View>

        {/* Earned titles */}
        {earnedTitles.length > 0 && (
          <View className="mt-2">
            <Text className="text-dark-text text-xs uppercase tracking-wider mb-2">
              Titles Earned
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {earnedTitles.map((title) => (
                <View
                  key={title}
                  className="bg-tribe-gold/20 px-3 py-1 rounded-full"
                >
                  <Text className="text-tribe-gold text-xs font-semibold">
                    {title}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

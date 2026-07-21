import { View, Text } from "react-native";

interface TribeInfoProps {
  tribeName: string | undefined;
  /** The fan's own Standing score. Despite the historical prop name, this
   *  is a point value, not a leaderboard position — labeled "Standing"
   *  below, not "Rank", to avoid implying a rank that isn't being fetched
   *  here (see the Standings tab for real rank). */
  rank: number | undefined;
}

/**
 * TribeInfo — shows the fan's Tribe name and current Standing beneath the match header.
 *
 * Requirement 3.2: THE Campfire screen SHALL display the fan's Tribe name
 * and current rank beneath the match header.
 */
export function TribeInfo({ tribeName, rank }: TribeInfoProps) {
  if (!tribeName) {
    return null;
  }

  return (
    <View className="w-full flex-row items-center justify-center py-2 px-6 mt-2">
      <Text className="text-tribe-gold text-sm font-semibold">{tribeName}</Text>
      {rank !== undefined && (
        <Text className="text-dark-text text-sm ml-3">
          Standing {rank}
        </Text>
      )}
    </View>
  );
}

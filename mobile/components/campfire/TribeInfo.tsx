import { View, Text } from "react-native";

interface TribeInfoProps {
  tribeName: string | undefined;
  rank: number | undefined;
}

/**
 * TribeInfo — shows the fan's Tribe name and current rank beneath the match header.
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
          Rank #{rank}
        </Text>
      )}
    </View>
  );
}

import { View, Text, type DimensionValue } from "react-native";

/**
 * PersonalStandingCard
 *
 * Displays the fan's personal Standing score with a visual progress bar.
 * The progress bar maps Standing on a 0–1000 scale by default, with the
 * fill color transitioning through tiers.
 *
 * Requirements: 7.2
 */

interface PersonalStandingCardProps {
  /** Fan's current standing score */
  standing: number;
  /** Fan's rank in the active leaderboard view */
  rank: number;
  /** Maximum standing for progress bar scale (defaults to 1000) */
  maxStanding?: number;
}

/**
 * Returns a Tailwind color class based on standing progress tier.
 */
function getProgressColor(progress: number): string {
  if (progress >= 0.75) return "bg-solar-green";
  if (progress >= 0.5) return "bg-solar-cyan";
  if (progress >= 0.25) return "bg-solar-yellow";
  return "bg-solar-orange";
}

export function PersonalStandingCard({
  standing,
  rank,
  maxStanding = 1000,
}: PersonalStandingCardProps) {
  const progress = Math.min(standing / maxStanding, 1);
  const progressPercentage = `${Math.round(progress * 100)}%`;
  const colorClass = getProgressColor(progress);

  return (
    <View className="bg-dark-surface rounded-2xl mx-4 mb-4 p-4">
      {/* Header row */}
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-dark-text-emphasis text-base font-semibold">
          Your Standing
        </Text>
        <View className="flex-row items-center">
          <Text className="text-dark-text text-xs mr-1">Rank</Text>
          <Text className="text-tribe-gold-bright text-base font-bold">
            #{rank}
          </Text>
        </View>
      </View>

      {/* Score display */}
      <View className="flex-row items-baseline mb-3">
        <Text className="text-white text-3xl font-bold">{standing}</Text>
        <Text className="text-dark-text text-sm ml-1">/ {maxStanding}</Text>
      </View>

      {/* Progress bar */}
      <View className="h-3 bg-dark-bg rounded-full overflow-hidden">
        <View
          className={`h-full rounded-full ${colorClass}`}
          style={{ width: progressPercentage as DimensionValue }}
          accessibilityRole="progressbar"
          accessibilityValue={{
            min: 0,
            max: maxStanding,
            now: standing,
          }}
        />
      </View>

      {/* Progress label */}
      <Text className="text-dark-text text-xs mt-2 text-right">
        {progressPercentage} of max
      </Text>
    </View>
  );
}

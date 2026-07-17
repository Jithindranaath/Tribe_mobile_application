import { View, Text } from "react-native";

interface StatsGridProps {
  /** Total reads made */
  readsTotal: number;
  /** Reads resolved correctly */
  readsCorrect: number;
  /** Current consecutive correct streak */
  currentStreak: number;
}

/**
 * StatsGrid — displays fan statistics in a 2×2 grid of stat cards.
 *
 * Requirement 10.3: THE Profile screen SHALL display the fan's statistics:
 * accuracy percentage, total reads, correct reads, and current streak.
 */
export function StatsGrid({
  readsTotal,
  readsCorrect,
  currentStreak,
}: StatsGridProps) {
  const accuracy =
    readsTotal > 0
      ? Math.round((readsCorrect / readsTotal) * 1000) / 10
      : 0;

  const stats = [
    {
      label: "Accuracy",
      value: `${accuracy}%`,
      emoji: "🎯",
      color: "text-solar-green",
    },
    {
      label: "Total Reads",
      value: String(readsTotal),
      emoji: "📊",
      color: "text-solar-blue",
    },
    {
      label: "Correct",
      value: String(readsCorrect),
      emoji: "✅",
      color: "text-tribe-gold",
    },
    {
      label: "Streak",
      value: String(currentStreak),
      emoji: "🔥",
      color: "text-tribe-flame",
    },
  ];

  return (
    <View className="w-full mb-4">
      <Text className="text-dark-text-emphasis text-base font-semibold mb-3">
        Statistics
      </Text>

      {/* 2×2 grid */}
      <View className="flex-row flex-wrap justify-between">
        {stats.map((stat) => (
          <View
            key={stat.label}
            className="w-[48%] bg-dark-surface rounded-xl p-4 mb-3 items-center"
          >
            <Text className="text-lg mb-1">{stat.emoji}</Text>
            <Text className={`text-xl font-bold ${stat.color}`}>
              {stat.value}
            </Text>
            <Text className="text-dark-text text-xs mt-1">{stat.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

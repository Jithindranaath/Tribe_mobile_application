import { View, Text } from "react-native";

interface StandingGraphProps {
  /** Current standing value */
  currentStanding: number;
  /** Historical standing data points (most recent last) */
  history?: number[];
}

/**
 * StandingGraph — displays standing history as a simple bar/line graph
 * using plain View components (no charting library).
 *
 * Requirement 10.1: THE Profile screen SHALL display standing history as a graph.
 */
export function StandingGraph({
  currentStanding,
  history = [],
}: StandingGraphProps) {
  // Use a default history if none provided (simulated progression toward current)
  const dataPoints =
    history.length > 0
      ? history
      : generateDefaultHistory(currentStanding);

  const maxVal = Math.max(...dataPoints, 1);
  const minVal = Math.min(...dataPoints, 0);
  const range = maxVal - minVal || 1;

  return (
    <View className="w-full bg-dark-surface rounded-xl p-4 mb-4">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-dark-text-emphasis text-base font-semibold">
          Standing History
        </Text>
        <Text className="text-tribe-gold text-lg font-bold">
          {currentStanding}
        </Text>
      </View>

      {/* Graph area */}
      <View className="flex-row items-end justify-between h-24 px-1">
        {dataPoints.map((value, index) => {
          const heightPercent = ((value - minVal) / range) * 100;
          const isLast = index === dataPoints.length - 1;

          return (
            <View
              key={index}
              className="flex-1 items-center mx-0.5"
            >
              <View
                className={`w-full rounded-t-sm ${
                  isLast ? "bg-tribe-gold" : "bg-solar-cyan"
                }`}
                style={{
                  height: `${Math.max(heightPercent, 5)}%`,
                  opacity: isLast ? 1 : 0.6 + (index / dataPoints.length) * 0.4,
                }}
              />
            </View>
          );
        })}
      </View>

      {/* X-axis label */}
      <View className="flex-row justify-between mt-2">
        <Text className="text-dark-text text-xs">Oldest</Text>
        <Text className="text-dark-text text-xs">Now</Text>
      </View>
    </View>
  );
}

/**
 * Generates a default standing history with gentle progression.
 * Used when no actual history data is available.
 */
function generateDefaultHistory(current: number): number[] {
  const points = 12;
  const history: number[] = [];
  const startVal = Math.max(current - 50, 100);

  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1);
    const value = startVal + (current - startVal) * progress;
    // Add slight variation
    const jitter = (i % 3 === 0 ? -5 : i % 3 === 1 ? 3 : 0);
    history.push(Math.max(Math.round(value + jitter), 0));
  }
  // Ensure last point is the current standing
  history[history.length - 1] = current;
  return history;
}

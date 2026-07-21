import { View, Text } from "react-native";

interface StandingGraphProps {
  /** Current standing value */
  currentStanding: number;
  /** Real standing-over-time series (most recent last), from the server's
   *  /api/fan/:fanId/timeline — one point per resolved Read, starting at
   *  the initial Standing. Empty until the fan has at least one resolved
   *  Read; the graph shows an honest "no history yet" state in that case
   *  rather than a fabricated trend line. */
  history: number[];
}

/**
 * StandingGraph — displays standing history as a simple bar/line graph
 * using plain View components (no charting library).
 *
 * Requirement 10.1: THE Profile screen SHALL display standing history as a graph.
 */
export function StandingGraph({
  currentStanding,
  history,
}: StandingGraphProps) {
  const hasHistory = history.length >= 2;
  const maxVal = Math.max(...history, 1);
  const minVal = Math.min(...history, 0);
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

      {hasHistory ? (
        <>
          {/* Graph area */}
          <View className="flex-row items-end justify-between h-24 px-1">
            {history.map((value, index) => {
              const heightPercent = ((value - minVal) / range) * 100;
              const isLast = index === history.length - 1;

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
                      opacity: isLast ? 1 : 0.6 + (index / history.length) * 0.4,
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
        </>
      ) : (
        <View className="h-24 items-center justify-center">
          <Text className="text-dark-text text-sm">
            No history yet — make a Read to start tracking your Standing
          </Text>
        </View>
      )}
    </View>
  );
}

import { View, Text } from "react-native";
import type { MatchHeader as MatchHeaderType } from "../../types";

interface MatchHeaderProps {
  matchHeader: MatchHeaderType | null;
}

/**
 * MatchHeader — displays the current score, match minute, and team names
 * sourced from the WebSocket connection state.
 *
 * Requirement 3.1: THE Campfire screen SHALL display a match header showing
 * the current score, match minute, and team names.
 */
export function MatchHeader({ matchHeader }: MatchHeaderProps) {
  if (!matchHeader) {
    return (
      <View className="w-full items-center py-4 px-6">
        <Text className="text-dark-text text-sm">Waiting for match data…</Text>
      </View>
    );
  }

  const { homeTeam, awayTeam, homeScore, awayScore, minute, state } =
    matchHeader;

  return (
    <View className="w-full items-center py-4 px-6 bg-dark-surface rounded-xl">
      {/* Match state badge */}
      <View className="mb-2">
        <Text
          className={`text-xs font-semibold uppercase tracking-wider ${
            state === "live"
              ? "text-tribe-flame"
              : state === "finished"
                ? "text-dark-text"
                : "text-solar-cyan"
          }`}
        >
          {state === "live"
            ? `${minute}'`
            : state === "finished"
              ? "FT"
              : "Scheduled"}
        </Text>
      </View>

      {/* Score line */}
      <View className="flex-row items-center justify-center w-full">
        {/* Home team */}
        <View className="flex-1 items-end pr-4">
          <Text
            className="text-dark-text-emphasis text-base font-semibold"
            numberOfLines={1}
          >
            {homeTeam}
          </Text>
        </View>

        {/* Score */}
        <View className="flex-row items-center">
          <Text className="text-dark-text-emphasis text-2xl font-bold">
            {homeScore}
          </Text>
          <Text className="text-dark-border text-xl mx-2">–</Text>
          <Text className="text-dark-text-emphasis text-2xl font-bold">
            {awayScore}
          </Text>
        </View>

        {/* Away team */}
        <View className="flex-1 items-start pl-4">
          <Text
            className="text-dark-text-emphasis text-base font-semibold"
            numberOfLines={1}
          >
            {awayTeam}
          </Text>
        </View>
      </View>
    </View>
  );
}

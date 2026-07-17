import { View, Text, Pressable } from "react-native";

/**
 * StandingsSegmentControl
 *
 * A three-tab segmented control for switching between global, country, and city
 * leaderboard views on the Standings screen.
 *
 * Requirements: 7.1
 */

export type StandingsView = "global" | "country" | "city";

interface StandingsSegmentControlProps {
  /** Currently active view */
  activeView: StandingsView;
  /** Callback when a segment is pressed */
  onViewChange: (view: StandingsView) => void;
}

const SEGMENTS: { key: StandingsView; label: string }[] = [
  { key: "global", label: "Global" },
  { key: "country", label: "Country" },
  { key: "city", label: "City" },
];

export function StandingsSegmentControl({
  activeView,
  onViewChange,
}: StandingsSegmentControlProps) {
  return (
    <View className="flex-row bg-dark-surface rounded-xl p-1 mx-4 mb-4">
      {SEGMENTS.map(({ key, label }) => {
        const isActive = activeView === key;
        return (
          <Pressable
            key={key}
            onPress={() => onViewChange(key)}
            className={`flex-1 items-center justify-center py-2.5 rounded-lg ${
              isActive ? "bg-solar-cyan" : "bg-transparent"
            }`}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${label} standings view`}
          >
            <Text
              className={`text-sm font-semibold ${
                isActive ? "text-dark-bg" : "text-dark-text"
              }`}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

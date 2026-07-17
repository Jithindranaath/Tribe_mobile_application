import { View, Text } from "react-native";
import { useCampfireStore } from "../../stores/useCampfireStore";

/**
 * PendingReadIndicator — compact badge showing pending read status
 * at the top of the Campfire area.
 *
 * Displays the count of pending reads (e.g., "1 pending read" / "2 pending reads")
 * and shows the first pending read's question truncated to keep it compact.
 *
 * Requirement 5.5: WHILE a Read is pending resolution, THE Mobile_App SHALL
 * display the pending Read in a compact indicator on the Campfire screen.
 */
export function PendingReadIndicator() {
  const pendingReads = useCampfireStore((s) => s.pendingReads);

  const pendingCount = pendingReads.size;

  if (pendingCount === 0) return null;

  // Get the first pending read's question for display
  const firstRead = pendingReads.values().next().value;
  const question = firstRead?.question ?? "";
  const truncatedQuestion =
    question.length > 40 ? `${question.slice(0, 40)}…` : question;

  const countLabel =
    pendingCount === 1 ? "1 pending read" : `${pendingCount} pending reads`;

  return (
    <View
      className="mx-4 mt-2 px-3 py-2 rounded-lg bg-tribe-gold/10 border border-tribe-gold/30"
      accessibilityRole="summary"
      accessibilityLabel={`${countLabel}: ${question}`}
    >
      <View className="flex-row items-center gap-2">
        {/* Indicator dot */}
        <View className="w-2 h-2 rounded-full bg-tribe-gold" />

        {/* Count label */}
        <Text className="text-tribe-gold text-xs font-semibold">
          {countLabel}
        </Text>
      </View>

      {/* Truncated question */}
      {truncatedQuestion ? (
        <Text
          className="text-dark-text text-xs mt-1 ml-4"
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {truncatedQuestion}
        </Text>
      ) : null}
    </View>
  );
}

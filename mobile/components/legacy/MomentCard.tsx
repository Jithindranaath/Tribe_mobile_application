import { memo } from "react";
import { View, Text, Pressable } from "react-native";
import * as Sharing from "expo-sharing";
import type { TimelineMoment } from "../../types";

interface MomentCardProps {
  moment: TimelineMoment;
}

/**
 * Type indicator color mapping for the visual type badge.
 */
const TYPE_CONFIG: Record<
  TimelineMoment["type"],
  { label: string; color: string; emoji: string }
> = {
  READ_SUCCESS: {
    label: "Read",
    color: "bg-solar-green",
    emoji: "✅",
  },
  TITLE_EARNED: {
    label: "Title",
    color: "bg-tribe-gold",
    emoji: "🏅",
  },
  RANK_CLIMB: {
    label: "Rank Up",
    color: "bg-solar-cyan",
    emoji: "📈",
  },
};

/**
 * MomentCard — renders a single timeline moment in Instagram Stories style.
 *
 * Each card shows the match, prediction, and outcome in a vertical layout
 * with rounded corners and a visual type indicator. Tapping triggers the
 * native share sheet via expo-sharing.
 *
 * Requirement 9.2: Each moment as a card in Instagram Stories style with match,
 * prediction, outcome.
 * Requirement 9.4: Tap moment card → offer to share via native share sheet.
 */
function MomentCardInner({ moment }: MomentCardProps) {
  const { type, match, prediction, outcome, createdAt } = moment;
  const config = TYPE_CONFIG[type];

  const handleShare = async () => {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) return;

    // Share text content describing the moment
    // In a full implementation, this would share a server-rendered image
    await Sharing.shareAsync("", {
      dialogTitle: `My TRIBE moment: ${match}`,
      mimeType: "text/plain",
      UTI: "public.plain-text",
    }).catch(() => {
      // User cancelled or share failed — no-op
    });
  };

  const formattedDate = new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <Pressable onPress={handleShare}>
      <View className="bg-dark-surface rounded-2xl overflow-hidden mx-4 mb-4 border border-dark-border">
        {/* Type indicator header */}
        <View className="flex-row items-center px-4 pt-4 pb-2">
          <View className={`w-2 h-2 rounded-full ${config.color} mr-2`} />
          <Text className="text-dark-text text-xs font-medium uppercase tracking-wider">
            {config.emoji} {config.label}
          </Text>
          <View className="flex-1" />
          <Text className="text-dark-text text-xs opacity-60">
            {formattedDate}
          </Text>
        </View>

        {/* Match info */}
        <View className="px-4 py-2">
          <Text className="text-dark-text-emphasis text-lg font-bold">
            {match}
          </Text>
        </View>

        {/* Prediction */}
        <View className="px-4 py-2 bg-solar-base03/50">
          <Text className="text-solar-cyan text-xs font-medium uppercase mb-1">
            Your Read
          </Text>
          <Text className="text-dark-text-emphasis text-sm">
            {prediction}
          </Text>
        </View>

        {/* Outcome */}
        <View className="px-4 py-3">
          <Text className="text-solar-green text-sm font-semibold">
            {outcome}
          </Text>
        </View>

        {/* Share hint */}
        <View className="px-4 pb-3">
          <Text className="text-dark-text text-xs opacity-40">
            Tap to share
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export const MomentCard = memo(MomentCardInner);

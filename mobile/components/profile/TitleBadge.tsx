import { View, Text } from "react-native";
import { Title, decodeTitles } from "../../types";

interface TitleBadgeProps {
  /** Title bitmask value from FanProfile.titles */
  titlesBitmask: number;
}

interface TitleInfo {
  title: Title;
  name: string;
  emoji: string;
  description: string;
  effect: string;
}

const TITLE_DETAILS: TitleInfo[] = [
  {
    title: Title.Seer,
    name: "Seer",
    emoji: "👁️",
    description: "Master predictor",
    effect: "Unlocks advanced Read types",
  },
  {
    title: Title.Chronicler,
    name: "Chronicler",
    emoji: "📜",
    description: "Story keeper",
    effect: "Unlocks timeline features",
  },
  {
    title: Title.Kindler,
    name: "Kindler",
    emoji: "🔥",
    description: "Flame contributor",
    effect: "Boosts tribe flame",
  },
  {
    title: Title.Keeper,
    name: "Keeper",
    emoji: "👑",
    description: "Community leader",
    effect: "Unlocks tribe management",
  },
];

/**
 * TitleBadge — displays earned titles decoded from the bitmask
 * with descriptions and gameplay effects.
 *
 * Requirement 10.2: THE Profile screen SHALL display earned Title badges
 * (Seer, Chronicler, Kindler, Keeper) with descriptions of each title's
 * condition and gameplay effect.
 */
export function TitleBadge({ titlesBitmask }: TitleBadgeProps) {
  const earnedTitles = decodeTitles(titlesBitmask);

  return (
    <View className="w-full bg-dark-surface rounded-xl p-4 mb-4">
      {/* Header */}
      <Text className="text-dark-text-emphasis text-base font-semibold mb-3">
        Earned Titles
      </Text>

      {/* Title grid */}
      {TITLE_DETAILS.map((info) => {
        const isEarned = earnedTitles.includes(info.title);

        return (
          <View
            key={info.title}
            className={`flex-row items-center p-3 rounded-lg mb-2 ${
              isEarned ? "bg-dark-bg" : "bg-dark-bg opacity-40"
            }`}
          >
            {/* Badge icon */}
            <View
              className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
                isEarned ? "bg-tribe-gold/20" : "bg-dark-surface"
              }`}
            >
              <Text className="text-lg">{info.emoji}</Text>
            </View>

            {/* Title info */}
            <View className="flex-1">
              <View className="flex-row items-center">
                <Text
                  className={`text-sm font-semibold ${
                    isEarned ? "text-tribe-gold" : "text-dark-text"
                  }`}
                >
                  {info.name}
                </Text>
                {isEarned && (
                  <Text className="text-xs text-solar-green ml-2">✓ Earned</Text>
                )}
              </View>
              <Text className="text-dark-text text-xs mt-0.5">
                {info.description}
              </Text>
              <Text className="text-solar-cyan text-xs mt-0.5">
                {info.effect}
              </Text>
            </View>
          </View>
        );
      })}

      {/* Summary */}
      {earnedTitles.length === 0 && (
        <Text className="text-dark-text text-xs text-center mt-2">
          No titles earned yet. Keep making Reads!
        </Text>
      )}
    </View>
  );
}

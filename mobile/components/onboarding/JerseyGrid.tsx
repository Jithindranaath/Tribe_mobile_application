/**
 * JerseyGrid — Visual team jersey/flag grid for World Cup team selection.
 *
 * Displays a grid of national teams with flag emojis and country names.
 * The fan selects their team (Macro_Tribe) to begin onboarding.
 * No blockchain terminology — this is purely a "pick your team" experience.
 */

import React from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  type ListRenderItemInfo,
} from "react-native";

// ─── Placeholder World Cup Teams ─────────────────────────────────────────────

export interface Team {
  id: string;
  name: string;
  flag: string;
  colors: [string, string]; // primary, secondary jersey hex colors
}

export const TEAMS: Team[] = [
  { id: "brazil", name: "Brazil", flag: "🇧🇷", colors: ["#facc15", "#16a34a"] },
  { id: "argentina", name: "Argentina", flag: "🇦🇷", colors: ["#7dd3fc", "#ffffff"] },
  { id: "germany", name: "Germany", flag: "🇩🇪", colors: ["#ffffff", "#000000"] },
  { id: "france", name: "France", flag: "🇫🇷", colors: ["#1d4ed8", "#ffffff"] },
  { id: "england", name: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", colors: ["#ffffff", "#dc2626"] },
  { id: "spain", name: "Spain", flag: "🇪🇸", colors: ["#dc2626", "#facc15"] },
  { id: "netherlands", name: "Netherlands", flag: "🇳🇱", colors: ["#f97316", "#ffffff"] },
  { id: "portugal", name: "Portugal", flag: "🇵🇹", colors: ["#b91c1c", "#15803d"] },
  { id: "japan", name: "Japan", flag: "🇯🇵", colors: ["#1e40af", "#ffffff"] },
  { id: "usa", name: "USA", flag: "🇺🇸", colors: ["#ffffff", "#1e3a5f"] },
  { id: "mexico", name: "Mexico", flag: "🇲🇽", colors: ["#15803d", "#ffffff"] },
  { id: "south-korea", name: "South Korea", flag: "🇰🇷", colors: ["#dc2626", "#1d4ed8"] },
];

// ─── Component ───────────────────────────────────────────────────────────────

interface JerseyGridProps {
  onSelect: (team: Team) => void;
  selectedTeamId?: string | null;
}

export function JerseyGrid({ onSelect, selectedTeamId }: JerseyGridProps) {
  const renderTeam = ({ item }: ListRenderItemInfo<Team>) => {
    const isSelected = selectedTeamId === item.id;

    return (
      <Pressable
        onPress={() => onSelect(item)}
        style={[
          styles.card,
          {
            borderColor: isSelected ? "#FF6B35" : "#586e75",
          },
        ]}
        accessibilityLabel={`Select ${item.name}`}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
      >
        {/* Flag */}
        <Text style={styles.flag}>{item.flag}</Text>

        {/* Jersey color stripe */}
        <View style={styles.stripeContainer}>
          <View style={[styles.stripe, { backgroundColor: item.colors[0] }]} />
          <View style={[styles.stripe, { backgroundColor: item.colors[1] }]} />
        </View>

        {/* Team name */}
        <Text
          style={[
            styles.teamName,
            { color: isSelected ? "#FF6B35" : "#93a1a1" },
          ]}
        >
          {item.name}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <Text style={styles.title}>Pick Your Jersey</Text>
      <Text style={styles.subtitle}>
        Choose the team you'll support in the World Cup
      </Text>

      {/* Grid */}
      <FlatList
        data={TEAMS}
        renderItem={renderTeam}
        keyExtractor={(item) => item.id}
        numColumns={3}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        maxToRenderPerBatch={12}
        windowSize={5}
      />
    </View>
  );
}

export default JerseyGrid;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#93a1a1",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#839496",
    textAlign: "center",
    marginBottom: 24,
  },
  card: {
    flex: 1,
    margin: 8,
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    backgroundColor: "#073642",
    minHeight: 120,
  },
  flag: {
    fontSize: 48,
    marginBottom: 8,
  },
  stripeContainer: {
    flexDirection: "row",
    width: "100%",
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 8,
  },
  stripe: {
    flex: 1,
  },
  teamName: {
    fontSize: 14,
    fontWeight: "600",
  },
});

/**
 * RegionPicker — City/region selector for Sub_Tribe assignment.
 *
 * After the fan picks a team (Macro_Tribe), they select a city/region
 * that forms their Sub_Tribe identity (e.g., "Brazil · Hyderabad").
 * No blockchain terminology anywhere in the UI.
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

// ─── Placeholder Region Data ─────────────────────────────────────────────────

export interface Region {
  id: string;
  city: string;
  country: string;
  emoji: string;
}

/**
 * Returns placeholder regions for a given team.
 * In production, these would come from the server.
 */
export function getRegionsForTeam(teamId: string): Region[] {
  // Shared cities that appear for all teams (global fan community)
  const sharedCities: Region[] = [
    { id: `${teamId}-london`, city: "London", country: "UK", emoji: "🏙️" },
    { id: `${teamId}-new-york`, city: "New York", country: "USA", emoji: "🗽" },
    { id: `${teamId}-mumbai`, city: "Mumbai", country: "India", emoji: "🌇" },
    { id: `${teamId}-hyderabad`, city: "Hyderabad", country: "India", emoji: "🏰" },
    { id: `${teamId}-dubai`, city: "Dubai", country: "UAE", emoji: "🏗️" },
    { id: `${teamId}-singapore`, city: "Singapore", country: "Singapore", emoji: "🦁" },
    { id: `${teamId}-tokyo`, city: "Tokyo", country: "Japan", emoji: "🗼" },
    { id: `${teamId}-berlin`, city: "Berlin", country: "Germany", emoji: "🐻" },
    { id: `${teamId}-sao-paulo`, city: "São Paulo", country: "Brazil", emoji: "🌆" },
    { id: `${teamId}-lagos`, city: "Lagos", country: "Nigeria", emoji: "🌍" },
  ];

  return sharedCities;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface RegionPickerProps {
  teamId: string;
  teamName: string;
  onSelect: (region: Region) => void;
  selectedRegionId?: string | null;
}

export function RegionPicker({
  teamId,
  teamName,
  onSelect,
  selectedRegionId,
}: RegionPickerProps) {
  const regions = getRegionsForTeam(teamId);

  const renderRegion = ({ item }: ListRenderItemInfo<Region>) => {
    const isSelected = selectedRegionId === item.id;

    return (
      <Pressable
        onPress={() => onSelect(item)}
        style={[
          styles.regionItem,
          {
            borderColor: isSelected ? "#FF6B35" : "#586e75",
          },
        ]}
        accessibilityLabel={`Select ${item.city}, ${item.country}`}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
      >
        {/* City emoji */}
        <Text style={styles.emoji}>{item.emoji}</Text>

        {/* City info */}
        <View style={styles.cityInfo}>
          <Text
            style={[
              styles.cityName,
              { color: isSelected ? "#FF6B35" : "#93a1a1" },
            ]}
          >
            {item.city}
          </Text>
          <Text style={styles.countryName}>{item.country}</Text>
        </View>

        {/* Sub-tribe preview */}
        <Text style={styles.tribePreview}>
          {teamName} · {item.city}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <Text style={styles.title}>Choose Your City</Text>
      <Text style={styles.subtitle}>
        Join fans from your area in the{" "}
        <Text style={styles.teamNameHighlight}>{teamName}</Text> tribe
      </Text>

      {/* Region list */}
      <FlatList
        data={regions}
        renderItem={renderRegion}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={5}
      />
    </View>
  );
}

export default RegionPicker;

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
  teamNameHighlight: {
    color: "#FF6B35",
    fontWeight: "600",
  },
  regionItem: {
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    backgroundColor: "#073642",
  },
  emoji: {
    fontSize: 24,
    marginRight: 16,
  },
  cityInfo: {
    flex: 1,
  },
  cityName: {
    fontSize: 16,
    fontWeight: "600",
  },
  countryName: {
    fontSize: 14,
    color: "#839496",
  },
  tribePreview: {
    fontSize: 12,
    color: "#839496",
  },
});

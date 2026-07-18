import { Tabs } from "expo-router";
import { Platform, Text } from "react-native";

/**
 * Main Tab Navigator
 *
 * Four tabs: Campfire, Standings, Legacy, Profile
 */
export default function MainTabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#FF6B35",
        tabBarInactiveTintColor: "#839496",
        tabBarStyle: {
          backgroundColor: "#073642",
          borderTopColor: "#586e75",
          ...(Platform.OS === "web" ? {} : { paddingBottom: 4 }),
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="campfire"
        options={{
          title: "Campfire",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🔥</Text>,
        }}
      />
      <Tabs.Screen
        name="standings"
        options={{
          title: "Standings",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>🏆</Text>,
        }}
      />
      <Tabs.Screen
        name="legacy"
        options={{
          title: "Legacy",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>📖</Text>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>👤</Text>,
        }}
      />
    </Tabs>
  );
}

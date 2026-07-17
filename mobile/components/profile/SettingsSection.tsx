import { View, Text, Switch } from "react-native";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useTheme } from "../../providers/ThemeProvider";

/**
 * SettingsSection — provides theme toggle (dark/light) and
 * notification preferences.
 *
 * Requirement 10.4: THE Profile screen SHALL provide a settings section
 * with theme toggle (dark/light) and notification preferences.
 */
export function SettingsSection() {
  const { isDark, toggleTheme, themePreference } = useTheme();
  const notificationsEnabled = useSettingsStore(
    (s) => s.notificationsEnabled
  );
  const setNotificationsEnabled = useSettingsStore(
    (s) => s.setNotificationsEnabled
  );

  return (
    <View className="w-full bg-dark-surface rounded-xl p-4 mb-4">
      {/* Header */}
      <Text className="text-dark-text-emphasis text-base font-semibold mb-4">
        Settings
      </Text>

      {/* Theme toggle */}
      <View className="flex-row items-center justify-between py-3 border-b border-dark-border">
        <View className="flex-1">
          <Text className="text-dark-text-emphasis text-sm font-medium">
            Dark Mode
          </Text>
          <Text className="text-dark-text text-xs mt-0.5">
            {themePreference === "system"
              ? "Following system preference"
              : `Set to ${themePreference}`}
          </Text>
        </View>
        <Switch
          value={isDark}
          onValueChange={toggleTheme}
          trackColor={{ false: "#93a1a1", true: "#2aa198" }}
          thumbColor={isDark ? "#fdf6e3" : "#002b36"}
        />
      </View>

      {/* Notifications toggle */}
      <View className="flex-row items-center justify-between py-3">
        <View className="flex-1">
          <Text className="text-dark-text-emphasis text-sm font-medium">
            Push Notifications
          </Text>
          <Text className="text-dark-text text-xs mt-0.5">
            Get notified when Read prompts fire during live matches
          </Text>
        </View>
        <Switch
          value={notificationsEnabled}
          onValueChange={setNotificationsEnabled}
          trackColor={{ false: "#93a1a1", true: "#2aa198" }}
          thumbColor={notificationsEnabled ? "#fdf6e3" : "#002b36"}
        />
      </View>
    </View>
  );
}

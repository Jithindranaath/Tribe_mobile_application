import { Stack } from "expo-router";

export default function MatchLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[fixtureId]" />
      <Stack.Screen name="replay/index" />
      <Stack.Screen name="replay/[fixtureId]" />
    </Stack>
  );
}

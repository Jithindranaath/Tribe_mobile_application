import { useEffect, useCallback } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCampfireStore } from "../../../stores/useCampfireStore";
import { useAuthStore } from "../../../stores/useAuthStore";
import { useCampfireSocket } from "../../../hooks/useCampfireSocket";
import { MatchHeader } from "../../../components/campfire/MatchHeader";
import { FlameVisual } from "../../../components/campfire/FlameVisual";
import { ConvictionPulse } from "../../../components/campfire/ConvictionPulse";
import { PresenceIndicator } from "../../../components/campfire/PresenceIndicator";
import { ReadPromptCard } from "../../../components/campfire/ReadPromptCard";
import { KeeperInject } from "../../../components/campfire/KeeperInject";
import { OfflineIndicator } from "../../../components/campfire/OfflineIndicator";
import { ReplayBadge } from "../../../components/campfire/ReplayBadge";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

// Accelerated so a full match (plus any extra time) plays out in a few
// minutes rather than real-time — this screen is a quick preview, not the
// full-length live demo.
const REPLAY_PLAYBACK_SPEED = 30;

/**
 * Replay Screen — the real Campfire experience driven by a real server-side
 * historical replay of the selected fixture (POST /api/demo/replay), not a
 * local scripted simulation. Reuses the same WebSocket hook and components
 * as the live Campfire screens, so nothing here is fabricated client-side.
 *
 * URI: tribe://replay/:fixtureId
 */
export default function ReplayScreen() {
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  const router = useRouter();
  const fan = useAuthStore((s) => s.fan);
  const matchHeader = useCampfireStore((s) => s.matchHeader);

  useEffect(() => {
    if (!fixtureId) return;

    useCampfireStore.setState({ fixtureId, isReplayMode: true });

    // Stop first in case another replay (e.g. the home tab's fallback demo)
    // is already active — the server rejects a second concurrent replay.
    fetch(`${BASE_URL}/api/demo/replay/stop`, { method: "POST" })
      .catch(() => {})
      .finally(() => {
        fetch(`${BASE_URL}/api/demo/replay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fixtureId, playbackSpeed: REPLAY_PLAYBACK_SPEED }),
        }).catch(() => {});
      });

    return () => {
      fetch(`${BASE_URL}/api/demo/replay/stop`, { method: "POST" }).catch(() => {});
      useCampfireStore.setState({ isReplayMode: false });
    };
  }, [fixtureId]);

  const { isOffline, retry, sendReadCommit } = useCampfireSocket({
    tribeId: fan?.tribeId ?? "",
    fixtureId: fixtureId ?? "",
    fanId: fan?.fanId,
  });

  useEffect(() => {
    useCampfireStore.getState().setWsSendReadCommit(sendReadCommit);
    return () => useCampfireStore.getState().setWsSendReadCommit(null);
  }, [sendReadCommit]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <View className="flex-1 bg-dark-bg">
      <ReplayBadge />

      <ScrollView className="flex-1" contentContainerClassName="pt-14 px-4 pb-8">
        <MatchHeader matchHeader={matchHeader} />

        <View className="w-full flex-row items-center justify-center py-2 px-6 mt-2">
          <Text className="text-tribe-gold text-sm font-semibold">
            {fan?.tribeName ?? "Unknown Tribe"}
          </Text>
        </View>

        <OfflineIndicator isOffline={isOffline} retry={retry} />

        <View className="items-center justify-center my-6">
          <FlameVisual />
        </View>

        <View className="items-center my-4">
          <ConvictionPulse />
        </View>

        <View className="items-center my-4">
          <PresenceIndicator />
        </View>

        <View className="flex-row items-center justify-center mt-6 gap-4">
          <Pressable
            onPress={handleBack}
            className="bg-dark-surface border border-dark-border rounded-xl px-5 py-3 active:opacity-80"
          >
            <Text className="text-dark-text text-sm font-semibold">← Exit</Text>
          </Pressable>
        </View>

        <View className="items-center mt-6">
          <Text className="text-dark-text text-xs opacity-60">
            Historical replay of fixture {fixtureId} • {REPLAY_PLAYBACK_SPEED}x speed • real TxLINE data
          </Text>
        </View>
      </ScrollView>

      <ReadPromptCard />
      <KeeperInject />
    </View>
  );
}

import { useEffect } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useCampfireStore } from "../../stores/useCampfireStore";
import { useAuthStore } from "../../stores/useAuthStore";
import { useCampfireSocket } from "../../hooks/useCampfireSocket";
import { MatchHeader } from "../../components/campfire/MatchHeader";
import { TribeInfo } from "../../components/campfire/TribeInfo";
import { FlameVisual } from "../../components/campfire/FlameVisual";
import { ConvictionPulse } from "../../components/campfire/ConvictionPulse";
import { PresenceIndicator } from "../../components/campfire/PresenceIndicator";
import { ReadPromptCard } from "../../components/campfire/ReadPromptCard";
import { SurgeOverlay } from "../../components/campfire/SurgeOverlay";
import { KeeperInject } from "../../components/campfire/KeeperInject";
import { PendingReadIndicator } from "../../components/campfire/PendingReadIndicator";
import { OfflineIndicator } from "../../components/campfire/OfflineIndicator";
import { SharePrompt } from "../../components/campfire/SharePrompt";

/**
 * Match Campfire (Deep Link)
 *
 * Deep-linkable campfire screen for a specific fixture.
 * URI: tribe://campfire/:fixtureId
 *
 * Reuses the same Campfire components (MatchHeader, FlameVisual, ConvictionPulse,
 * PresenceIndicator, ReadPromptCard, SurgeOverlay, KeeperInject, etc.) but is
 * accessible directly via deep link outside of the tab navigator.
 *
 * The fixtureId route param drives the WebSocket connection.
 *
 * Requirements: 1.2, 8.4
 */
export default function MatchScreen() {
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  const fan = useAuthStore((s) => s.fan);
  const matchHeader = useCampfireStore((s) => s.matchHeader);

  // Set the fixtureId in store when entering this deep-linked screen
  useEffect(() => {
    if (fixtureId) {
      useCampfireStore.setState({ fixtureId });
    }
  }, [fixtureId]);

  // Connect to the WebSocket for real-time match data using the deep-linked fixtureId
  const { isOffline, retry, sendReadCommit } = useCampfireSocket({
    tribeId: fan?.tribeId ?? "",
    fixtureId: fixtureId ?? "",
    fanId: fan?.fanId,
  });

  useEffect(() => {
    useCampfireStore.getState().setWsSendReadCommit(sendReadCommit);
    return () => useCampfireStore.getState().setWsSendReadCommit(null);
  }, [sendReadCommit]);

  return (
    <View className="flex-1 bg-dark-bg pt-12 px-4">
      {/* Match Header — score, minute, team names */}
      <MatchHeader matchHeader={matchHeader} />

      {/* Tribe Info — tribe name and rank */}
      <TribeInfo tribeName={fan?.tribeName} rank={fan?.standing} />

      {/* Offline indicator — shown after 4 failed reconnection attempts */}
      <OfflineIndicator isOffline={isOffline} retry={retry} />

      {/* Pending read indicator */}
      <PendingReadIndicator />

      {/* Central flame area with conviction ring */}
      <View className="flex-1 items-center justify-center">
        <ConvictionPulse />
        <FlameVisual />
      </View>

      {/* Presence indicator — active tribe members */}
      <View className="items-center pb-4">
        <PresenceIndicator />
      </View>

      {/* ─── Overlay layers (absolute positioned) ─── */}

      {/* Keeper inject floating text */}
      <KeeperInject />

      {/* Read prompt card — slides up from bottom */}
      <ReadPromptCard />

      {/* Surge celebration overlay */}
      <SurgeOverlay />

      {/* Share prompt — appears after surge dismiss */}
      <SharePrompt />
    </View>
  );
}

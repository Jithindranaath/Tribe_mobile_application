import { useEffect } from "react";
import { View } from "react-native";
import { useCampfireStore } from "../../stores/useCampfireStore";
import { useAuthStore } from "../../stores/useAuthStore";
import { useTimelineStore } from "../../stores/useTimelineStore";
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
 * Campfire Screen (main tab)
 *
 * Real, live-connected Campfire — same WebSocket wiring and components as
 * the deep-linkable (match)/[fixtureId] screen. Previously this screen was
 * a hardcoded local timer simulation with no server connection at all;
 * replaced so the tab a fan actually lands on shows genuine live match
 * data instead of a canned demo.
 *
 * There's no "which match is live for me" discovery flow yet, so this
 * falls back to a known-good demo fixtureId when the store hasn't been
 * given one via a deep link or join flow. Using the actual World Cup Final
 * (Spain v Argentina, fixtureId 18257739) here, not a placeholder match —
 * this is real historical TxLINE data from the tournament this app was
 * built for, went to extra time, confirmed present in match_events.
 */
const FALLBACK_DEMO_FIXTURE_ID = "18257739";

export default function CampfireScreen() {
  const fan = useAuthStore((s) => s.fan);
  const storeFixtureId = useCampfireStore((s) => s.fixtureId);
  const matchHeader = useCampfireStore((s) => s.matchHeader);
  const standingHistory = useTimelineStore((s) => s.standingHistory);
  const fetchTimeline = useTimelineStore((s) => s.fetchTimeline);

  const fixtureId = storeFixtureId ?? FALLBACK_DEMO_FIXTURE_ID;

  // fan.standing is a snapshot from login and never refreshes on its own —
  // fetch the real current value (see profile.tsx for the same pattern).
  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  const currentStanding =
    standingHistory.length > 0 ? standingHistory[standingHistory.length - 1] : fan?.standing;

  useEffect(() => {
    if (!storeFixtureId) {
      useCampfireStore.setState({ fixtureId: FALLBACK_DEMO_FIXTURE_ID });
    }
  }, [storeFixtureId]);

  const { isOffline, retry, sendReadCommit } = useCampfireSocket({
    tribeId: fan?.tribeId ?? "",
    fixtureId,
    fanId: fan?.fanId,
  });

  useEffect(() => {
    useCampfireStore.getState().setWsSendReadCommit(sendReadCommit);
    return () => useCampfireStore.getState().setWsSendReadCommit(null);
  }, [sendReadCommit]);

  return (
    <View className="flex-1 bg-dark-bg pt-12 px-4">
      <MatchHeader matchHeader={matchHeader} />
      <TribeInfo tribeName={fan?.tribeName} rank={currentStanding} />
      <OfflineIndicator isOffline={isOffline} retry={retry} />
      <PendingReadIndicator />

      <View className="flex-1 items-center justify-center">
        <ConvictionPulse />
        <FlameVisual />
      </View>

      <View className="items-center pb-4">
        <PresenceIndicator />
      </View>

      <KeeperInject />
      <ReadPromptCard />
      <SurgeOverlay />
      <SharePrompt />
    </View>
  );
}

import { useEffect, useRef, useCallback, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCampfireStore } from "../../../stores/useCampfireStore";
import { useAuthStore } from "../../../stores/useAuthStore";
import { MatchHeader } from "../../../components/campfire/MatchHeader";
import { FlameVisual } from "../../../components/campfire/FlameVisual";
import { ConvictionPulse } from "../../../components/campfire/ConvictionPulse";
import { PresenceIndicator } from "../../../components/campfire/PresenceIndicator";
import { ReadPromptCard } from "../../../components/campfire/ReadPromptCard";
import { KeeperInject } from "../../../components/campfire/KeeperInject";
import { ReplayBadge } from "../../../components/campfire/ReplayBadge";
import { signalToIntensity } from "../../../types";
import type { MatchHeader as MatchHeaderType, ReadPromptPayload } from "../../../types";

/**
 * Replay Screen — simulates the live Campfire experience using historical
 * TxLINE data streamed at accelerated playback speed.
 *
 * Reuses all core Campfire components (MatchHeader, FlameVisual, ConvictionPulse,
 * PresenceIndicator, ReadPromptCard, KeeperInject) and displays a "REPLAY" badge.
 *
 * Key behaviors:
 * - Sets `isReplayMode = true` on the campfire store
 * - Reads committed in replay mode resolve locally (no network calls)
 * - Historical data is simulated via setInterval pushing state changes to the store
 * - Accelerated playback: ~10 seconds per in-game minute
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 * URI: tribe://replay/:fixtureId
 */
export default function ReplayScreen() {
  const { fixtureId } = useLocalSearchParams<{ fixtureId: string }>();
  const router = useRouter();
  const fan = useAuthStore((s) => s.fan);
  const matchHeader = useCampfireStore((s) => s.matchHeader);
  const isReplayMode = useCampfireStore((s) => s.isReplayMode);

  const [playbackMinute, setPlaybackMinute] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const simulationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventIndexRef = useRef(0);

  // ─── Enter replay mode on mount, clean up on unmount ─────────────────────────

  useEffect(() => {
    // Set replay mode and initialize fixture state
    useCampfireStore.setState({
      isReplayMode: true,
      fixtureId: fixtureId ?? null,
      connected: false, // no real WS connection in replay
      matchHeader: buildInitialMatchHeader(fixtureId),
      presence: { count: 0, tribeId: fan?.tribeId ?? "", fixtureId: fixtureId ?? "" },
      conviction: { signal: 0, percentage: 0, tribeId: fan?.tribeId ?? "" },
      flameIntensity: "dim",
      activePrompt: null,
      surgeActive: false,
      surgePayload: null,
      keeperMessage: null,
    });

    return () => {
      // Clean up replay mode state on unmount
      if (simulationRef.current) {
        clearInterval(simulationRef.current);
        simulationRef.current = null;
      }
      useCampfireStore.setState({
        isReplayMode: false,
        matchHeader: null,
        presence: null,
        conviction: null,
        flameIntensity: "dim",
        activePrompt: null,
        surgeActive: false,
        surgePayload: null,
        keeperMessage: null,
      });
    };
  }, [fixtureId, fan?.tribeId]);

  // ─── Historical data simulation (accelerated playback) ───────────────────────

  useEffect(() => {
    if (!isPlaying) {
      if (simulationRef.current) {
        clearInterval(simulationRef.current);
        simulationRef.current = null;
      }
      return;
    }

    // Generate historical events for this fixture
    const events = generateReplayEvents(fixtureId ?? "1001");

    // Tick every 2 seconds = ~1 in-game minute at accelerated speed
    const TICK_INTERVAL_MS = 2000;

    simulationRef.current = setInterval(() => {
      setPlaybackMinute((prev) => {
        const nextMinute = prev + 1;

        if (nextMinute > 90) {
          // Match ended
          if (simulationRef.current) {
            clearInterval(simulationRef.current);
            simulationRef.current = null;
          }
          setIsPlaying(false);
          useCampfireStore.setState((state) => ({
            matchHeader: state.matchHeader
              ? { ...state.matchHeader, minute: 90, state: "finished" }
              : null,
          }));
          return 90;
        }

        // Update match minute
        useCampfireStore.setState((state) => ({
          matchHeader: state.matchHeader
            ? { ...state.matchHeader, minute: nextMinute }
            : null,
        }));

        // Process any events scheduled for this minute
        while (
          eventIndexRef.current < events.length &&
          events[eventIndexRef.current].minute <= nextMinute
        ) {
          const event = events[eventIndexRef.current];
          applyReplayEvent(event, fan?.tribeId ?? "");
          eventIndexRef.current++;
        }

        return nextMinute;
      });
    }, TICK_INTERVAL_MS);

    return () => {
      if (simulationRef.current) {
        clearInterval(simulationRef.current);
        simulationRef.current = null;
      }
    };
  }, [isPlaying, fixtureId, fan?.tribeId]);

  // ─── Playback controls ───────────────────────────────────────────────────────

  const togglePlayback = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <View className="flex-1 bg-dark-bg">
      {/* REPLAY badge — floating at top */}
      <ReplayBadge />

      <ScrollView
        className="flex-1"
        contentContainerClassName="pt-14 px-4 pb-8"
      >
        {/* Match Header — reused from Campfire */}
        <MatchHeader matchHeader={matchHeader} />

        {/* Tribe Info */}
        <View className="w-full flex-row items-center justify-center py-2 px-6 mt-2">
          <Text className="text-tribe-gold text-sm font-semibold">
            {fan?.tribeName ?? "Unknown Tribe"}
          </Text>
        </View>

        {/* Flame Visual */}
        <View className="items-center justify-center my-6">
          <FlameVisual />
        </View>

        {/* Conviction Pulse */}
        <View className="items-center my-4">
          <ConvictionPulse />
        </View>

        {/* Presence Indicator */}
        <View className="items-center my-4">
          <PresenceIndicator />
        </View>

        {/* Playback controls */}
        <View className="flex-row items-center justify-center mt-6 gap-4">
          <Pressable
            onPress={handleBack}
            className="bg-dark-surface border border-dark-border rounded-xl px-5 py-3 active:opacity-80"
          >
            <Text className="text-dark-text text-sm font-semibold">
              ← Exit
            </Text>
          </Pressable>

          <Pressable
            onPress={togglePlayback}
            className="bg-solar-violet/80 rounded-xl px-6 py-3 active:opacity-80"
          >
            <Text className="text-white text-sm font-bold">
              {isPlaying ? "⏸ Pause" : "▶ Play"}
            </Text>
          </Pressable>

          <View className="bg-dark-surface border border-dark-border rounded-xl px-4 py-3">
            <Text className="text-dark-text-emphasis text-sm font-mono">
              {playbackMinute}'
            </Text>
          </View>
        </View>

        {/* Replay info */}
        <View className="items-center mt-6">
          <Text className="text-dark-text text-xs opacity-60">
            Historical replay • Reads resolve locally • No Standing changes
          </Text>
        </View>
      </ScrollView>

      {/* Read Prompt Card — slides up from bottom (reused) */}
      <ReadPromptCard />

      {/* Keeper Inject overlay (reused) */}
      <KeeperInject />
    </View>
  );
}

// ─── Replay Event Types ──────────────────────────────────────────────────────

interface ReplayEvent {
  minute: number;
  type:
    | "presence"
    | "conviction"
    | "score"
    | "read_prompt"
    | "keeper_inject"
    | "surge";
  data: Record<string, unknown>;
}

// ─── Build initial match header from fixtureId ───────────────────────────────

function buildInitialMatchHeader(
  fixtureId: string | undefined
): MatchHeaderType {
  // Use mock match data based on fixtureId
  const fixtures: Record<string, { home: string; away: string }> = {
    "1001": { home: "Brazil", away: "Argentina" },
    "1002": { home: "Germany", away: "France" },
    "1003": { home: "England", away: "Spain" },
    "1004": { home: "Japan", away: "Mexico" },
    "1005": { home: "USA", away: "Portugal" },
  };

  const match = fixtures[fixtureId ?? "1001"] ?? {
    home: "Team A",
    away: "Team B",
  };

  return {
    fixtureId: fixtureId ?? "1001",
    homeTeam: match.home,
    awayTeam: match.away,
    homeScore: 0,
    awayScore: 0,
    minute: 0,
    state: "live",
  };
}

// ─── Generate simulated replay events for a fixture ──────────────────────────

function generateReplayEvents(fixtureId: string): ReplayEvent[] {
  // Deterministic pseudo-random based on fixtureId for consistent replays
  const seed = Number(fixtureId) || 1001;

  const events: ReplayEvent[] = [
    // Early presence ramp-up
    { minute: 1, type: "presence", data: { activeCount: 24 } },
    { minute: 3, type: "conviction", data: { signal: 15, percentage: 12 } },
    { minute: 5, type: "presence", data: { activeCount: 48 } },
    { minute: 8, type: "keeper_inject", data: { message: "Both sides testing each other early…", emotion: "neutral" } },
    { minute: 10, type: "conviction", data: { signal: 25, percentage: 20 } },

    // Building tension
    { minute: 15, type: "presence", data: { activeCount: 67 } },
    { minute: 18, type: "conviction", data: { signal: 40, percentage: 35 } },
    { minute: 20, type: "keeper_inject", data: { message: "Dangerous free kick coming up!", emotion: "tense" } },
    {
      minute: 22,
      type: "read_prompt",
      data: {
        readId: `replay-${fixtureId}-read-1`,
        question: "Goal scored in the next 5 minutes?",
        multiplier: 2.5,
        readType: "moment_read",
      },
    },

    // First goal
    { minute: 27, type: "conviction", data: { signal: 60, percentage: 55 } },
    { minute: 28, type: "score", data: { homeScore: 1, awayScore: 0 } },
    { minute: 28, type: "keeper_inject", data: { message: "GOAL! The home side strikes first!", emotion: "euphoric" } },
    {
      minute: 29,
      type: "surge",
      data: { readId: `replay-${fixtureId}-read-1`, standingEarned: 15, newStanding: 115, message: "CALLED IT" },
    },

    // Mid-first half
    { minute: 32, type: "presence", data: { activeCount: 89 } },
    { minute: 35, type: "conviction", data: { signal: 45, percentage: 40 } },
    { minute: 38, type: "keeper_inject", data: { message: "Possession shifting… momentum building", emotion: "neutral" } },

    // Second Read prompt
    {
      minute: 40,
      type: "read_prompt",
      data: {
        readId: `replay-${fixtureId}-read-2`,
        question: "Will there be a second goal before half-time?",
        multiplier: 3.0,
        readType: "momentum_read",
      },
    },
    { minute: 43, type: "conviction", data: { signal: 70, percentage: 62 } },
    { minute: 45, type: "keeper_inject", data: { message: "Half-time approaching…", emotion: "neutral" } },

    // Half-time lull
    { minute: 46, type: "presence", data: { activeCount: 72 } },
    { minute: 48, type: "conviction", data: { signal: 30, percentage: 25 } },

    // Second half begins
    { minute: 50, type: "presence", data: { activeCount: 95 } },
    { minute: 52, type: "conviction", data: { signal: 50, percentage: 45 } },
    { minute: 55, type: "keeper_inject", data: { message: "Second half underway — intensity rising", emotion: "tense" } },

    // Third Read prompt
    {
      minute: 58,
      type: "read_prompt",
      data: {
        readId: `replay-${fixtureId}-read-3`,
        question: "Red card before 70th minute?",
        multiplier: 4.0,
        readType: "instinct_read",
      },
    },
    { minute: 62, type: "conviction", data: { signal: 75, percentage: 70 } },

    // Equalizer
    { minute: 65, type: "score", data: { homeScore: 1, awayScore: 1 } },
    { minute: 65, type: "keeper_inject", data: { message: "EQUALIZER! It's all square now!", emotion: "euphoric" } },
    { minute: 66, type: "presence", data: { activeCount: 112 } },
    { minute: 68, type: "conviction", data: { signal: 85, percentage: 78 } },

    // Late drama
    { minute: 72, type: "keeper_inject", data: { message: "Tension in the air… who wants it more?", emotion: "dramatic" } },
    {
      minute: 75,
      type: "read_prompt",
      data: {
        readId: `replay-${fixtureId}-read-4`,
        question: "Winner decided in the last 15 minutes?",
        multiplier: 2.0,
        readType: "moment_read",
      },
    },
    { minute: 78, type: "conviction", data: { signal: 90, percentage: 85 } },

    // Late winner
    { minute: 82, type: "score", data: { homeScore: 2, awayScore: 1 } },
    { minute: 82, type: "keeper_inject", data: { message: "DRAMATIC LATE WINNER!", emotion: "euphoric" } },
    {
      minute: 83,
      type: "surge",
      data: { readId: `replay-${fixtureId}-read-4`, standingEarned: 20, newStanding: 135, message: "INCREDIBLE CALL" },
    },
    { minute: 84, type: "presence", data: { activeCount: 128 } },
    { minute: 85, type: "conviction", data: { signal: 100, percentage: 92 } },

    // Wind down
    { minute: 88, type: "conviction", data: { signal: 60, percentage: 50 } },
    { minute: 89, type: "keeper_inject", data: { message: "Final moments…", emotion: "dramatic" } },
    { minute: 90, type: "presence", data: { activeCount: 130 } },
  ];

  return events;
}

// ─── Apply a replay event to the campfire store ──────────────────────────────

function applyReplayEvent(event: ReplayEvent, tribeId: string) {
  const store = useCampfireStore.getState();

  switch (event.type) {
    case "presence":
      useCampfireStore.setState({
        presence: {
          count: event.data.activeCount as number,
          tribeId,
          fixtureId: store.fixtureId ?? "",
        },
      });
      break;

    case "conviction": {
      const signal = event.data.signal as number;
      const percentage = event.data.percentage as number;
      useCampfireStore.setState({
        conviction: { signal, percentage, tribeId },
        flameIntensity: signalToIntensity(signal),
      });
      break;
    }

    case "score":
      useCampfireStore.setState((state) => ({
        matchHeader: state.matchHeader
          ? {
              ...state.matchHeader,
              homeScore: event.data.homeScore as number,
              awayScore: event.data.awayScore as number,
            }
          : null,
      }));
      break;

    case "read_prompt": {
      const prompt: ReadPromptPayload = {
        readId: event.data.readId as string,
        question: event.data.question as string,
        options: ["YES", "NO"],
        multiplier: event.data.multiplier as number,
        expiresAt: Date.now() + 15000, // 15 second window in replay
        readType: (event.data.readType as ReadPromptPayload["readType"]) ?? "moment_read",
      };
      useCampfireStore.setState({ activePrompt: prompt });
      break;
    }

    case "keeper_inject":
      useCampfireStore.setState({
        keeperMessage: {
          message: event.data.message as string,
          emotion: event.data.emotion as "neutral" | "tense" | "euphoric" | "dramatic",
        },
      });
      break;

    case "surge":
      // In replay mode, surge is visual only — no real Standing changes
      useCampfireStore.setState({
        surgeActive: true,
        surgePayload: {
          readId: event.data.readId as string,
          standingEarned: event.data.standingEarned as number,
          newStanding: event.data.newStanding as number,
          message: event.data.message as string,
        },
      });
      break;
  }
}

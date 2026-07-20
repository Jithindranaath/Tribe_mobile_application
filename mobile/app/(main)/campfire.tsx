import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useCampfireStore, useAuthStore } from "../../stores";
import { signalToIntensity } from "../../types";

/**
 * Campfire Screen — Self-demo mode
 * 
 * Simulates live match data directly without needing a server connection.
 * Shows match header, flame intensity, presence, conviction, and read prompts.
 */
export default function CampfireScreen() {
  const fan = useAuthStore((s) => s.fan);
  const matchHeader = useCampfireStore((s) => s.matchHeader);
  const presence = useCampfireStore((s) => s.presence);
  const conviction = useCampfireStore((s) => s.conviction);
  const flameIntensity = useCampfireStore((s) => s.flameIntensity);
  const activePrompt = useCampfireStore((s) => s.activePrompt);
  const surgeActive = useCampfireStore((s) => s.surgeActive);
  const surgePayload = useCampfireStore((s) => s.surgePayload);
  const keeperMessage = useCampfireStore((s) => s.keeperMessage);
  const commitRead = useCampfireStore((s) => s.commitRead);
  const dismissPrompt = useCampfireStore((s) => s.dismissPrompt);
  const dismissSurge = useCampfireStore((s) => s.dismissSurge);

  const [demoRunning, setDemoRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const minuteRef = useRef(0);

  // Start demo simulation
  const startDemo = () => {
    setDemoRunning(true);
    minuteRef.current = 0;

    // Set initial match state
    useCampfireStore.setState({
      matchHeader: {
        fixtureId: "demo-1",
        homeTeam: "Brazil",
        awayTeam: "Argentina",
        homeScore: 0,
        awayScore: 0,
        minute: 0,
        state: "live",
      },
      presence: { count: 34, tribeId: "demo", fixtureId: "demo-1" },
      conviction: { signal: 20, percentage: 15, tribeId: "demo" },
      flameIntensity: "dim",
    });

    // Tick every 2 seconds = 1 match minute
    timerRef.current = setInterval(() => {
      minuteRef.current += 1;
      const min = minuteRef.current;

      // Update match minute
      useCampfireStore.setState((s) => ({
        matchHeader: s.matchHeader ? { ...s.matchHeader, minute: min } : null,
      }));

      // Simulate events at specific minutes
      if (min === 3) {
        useCampfireStore.setState({
          presence: { count: 56, tribeId: "demo", fixtureId: "demo-1" },
          conviction: { signal: 35, percentage: 28, tribeId: "demo" },
          flameIntensity: signalToIntensity(35),
        });
      }
      if (min === 5) {
        useCampfireStore.setState({
          keeperMessage: { message: "Tension building... both sides pressing!", emotion: "tense" },
        });
        setTimeout(() => useCampfireStore.setState({ keeperMessage: null }), 4000);
      }
      if (min === 8) {
        useCampfireStore.setState({
          activePrompt: {
            readId: "demo-read-1",
            question: "Goal scored in the next 5 minutes?",
            options: ["YES", "NO"],
            multiplier: 2.5,
            expiresAt: Date.now() + 15000,
            readType: "moment_read",
          },
          conviction: { signal: 55, percentage: 48, tribeId: "demo" },
          flameIntensity: signalToIntensity(55),
          presence: { count: 78, tribeId: "demo", fixtureId: "demo-1" },
        });
      }
      if (min === 12) {
        // Goal!
        useCampfireStore.setState((s) => ({
          matchHeader: s.matchHeader ? { ...s.matchHeader, homeScore: 1 } : null,
          conviction: { signal: 80, percentage: 72, tribeId: "demo" },
          flameIntensity: signalToIntensity(80),
          presence: { count: 95, tribeId: "demo", fixtureId: "demo-1" },
          keeperMessage: { message: "GOAL!! Brazil strikes first! 🎉", emotion: "euphoric" },
        }));
        setTimeout(() => useCampfireStore.setState({ keeperMessage: null }), 4000);
      }
      if (min === 14) {
        // Surge
        useCampfireStore.setState({
          surgeActive: true,
          surgePayload: { readId: "demo-read-1", standingEarned: 15, newStanding: 115, message: "CALLED IT!" },
        });
      }
      if (min === 18) {
        useCampfireStore.setState({
          conviction: { signal: 90, percentage: 85, tribeId: "demo" },
          flameIntensity: signalToIntensity(90),
          presence: { count: 112, tribeId: "demo", fixtureId: "demo-1" },
          keeperMessage: { message: "The crowd is on fire! Blazing energy!", emotion: "euphoric" },
        });
        setTimeout(() => useCampfireStore.setState({ keeperMessage: null }), 4000);
      }
      if (min === 22) {
        useCampfireStore.setState({
          activePrompt: {
            readId: "demo-read-2",
            question: "Will there be a second goal before half-time?",
            options: ["YES", "NO"],
            multiplier: 3.0,
            expiresAt: Date.now() + 15000,
            readType: "momentum_read",
          },
        });
      }
      if (min >= 25) {
        // End demo
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        useCampfireStore.setState((s) => ({
          matchHeader: s.matchHeader ? { ...s.matchHeader, state: "finished", minute: 90 } : null,
          keeperMessage: { message: "Full time! What a match!", emotion: "dramatic" },
        }));
        setTimeout(() => {
          useCampfireStore.setState({ keeperMessage: null });
          setDemoRunning(false);
        }, 4000);
      }
    }, 2000);
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Flame emoji based on intensity
  const flameEmoji = flameIntensity === "blazing" ? "🔥🔥🔥" : flameIntensity === "bright" ? "🔥🔥" : flameIntensity === "steady" ? "🔥" : "🕯️";

  return (
    <View style={styles.container}>
      {/* Match Header */}
      {matchHeader ? (
        <View style={styles.matchHeader}>
          <Text style={styles.matchState}>
            {matchHeader.state === "live" ? `${matchHeader.minute}'` : matchHeader.state === "finished" ? "FT" : "Scheduled"}
          </Text>
          <View style={styles.scoreRow}>
            <Text style={styles.teamName}>{matchHeader.homeTeam}</Text>
            <Text style={styles.score}>{matchHeader.homeScore} - {matchHeader.awayScore}</Text>
            <Text style={styles.teamName}>{matchHeader.awayTeam}</Text>
          </View>
        </View>
      ) : (
        <View style={styles.matchHeader}>
          <Text style={styles.waitingText}>Waiting for match data...</Text>
        </View>
      )}

      {/* Tribe Info */}
      <Text style={styles.tribeInfo}>{fan?.tribeName ?? "Dev Tribe"} • Rank #{fan?.standing ?? 100}</Text>

      {/* Keeper Message */}
      {keeperMessage && (
        <View style={styles.keeperBanner}>
          <Text style={[styles.keeperText, { color: keeperMessage.emotion === "euphoric" ? "#FFD700" : keeperMessage.emotion === "tense" ? "#dc322f" : "#93a1a1" }]}>
            {keeperMessage.message}
          </Text>
        </View>
      )}

      {/* Flame Visual */}
      <View style={styles.flameContainer}>
        <Text style={styles.flameEmoji}>{flameEmoji}</Text>
        <Text style={styles.intensityLabel}>{flameIntensity.toUpperCase()}</Text>
      </View>

      {/* Conviction + Presence */}
      {conviction && (
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{conviction.percentage}%</Text>
            <Text style={styles.statLabel}>Committed</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{presence?.count ?? 0}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{conviction.signal}</Text>
            <Text style={styles.statLabel}>Signal</Text>
          </View>
        </View>
      )}

      {/* Surge Overlay */}
      {surgeActive && surgePayload && (
        <View style={styles.surgeOverlay}>
          <Text style={styles.surgePoints}>+{surgePayload.standingEarned}</Text>
          <Text style={styles.surgeLabel}>Standing</Text>
          <Text style={styles.surgeMessage}>{surgePayload.message}</Text>
          <Pressable onPress={dismissSurge} style={styles.surgeButton}>
            <Text style={styles.surgeButtonText}>Dismiss</Text>
          </Pressable>
        </View>
      )}

      {/* Read Prompt */}
      {activePrompt && !surgeActive && (
        <View style={styles.promptCard}>
          <View style={styles.promptHeader}>
            <Text style={styles.multiplier}>{activePrompt.multiplier}x</Text>
          </View>
          <Text style={styles.promptQuestion}>{activePrompt.question}</Text>
          <View style={styles.promptButtons}>
            <Pressable onPress={() => commitRead(activePrompt.readId, 1)} style={styles.yesButton}>
              <Text style={styles.buttonText}>YES</Text>
            </Pressable>
            <Pressable onPress={() => commitRead(activePrompt.readId, 0)} style={styles.noButton}>
              <Text style={styles.buttonText}>NO</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Start Demo Button */}
      {!demoRunning && !matchHeader && (
        <Pressable onPress={startDemo} style={styles.startButton}>
          <Text style={styles.startButtonText}>▶ Start Live Demo</Text>
        </Pressable>
      )}
      {!demoRunning && matchHeader?.state === "finished" && (
        <Pressable onPress={startDemo} style={styles.startButton}>
          <Text style={styles.startButtonText}>🔄 Replay Demo</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#002b36", paddingTop: 48, paddingHorizontal: 16 },
  matchHeader: { backgroundColor: "#073642", borderRadius: 12, padding: 16, alignItems: "center", marginBottom: 12 },
  matchState: { color: "#FF6B35", fontSize: 14, fontWeight: "700", marginBottom: 8 },
  scoreRow: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  teamName: { color: "#93a1a1", fontSize: 16, fontWeight: "600", flex: 1, textAlign: "center" },
  score: { color: "#ffffff", fontSize: 28, fontWeight: "bold", marginHorizontal: 16 },
  waitingText: { color: "#839496", fontSize: 14 },
  tribeInfo: { color: "#d4a017", fontSize: 14, fontWeight: "600", textAlign: "center", marginBottom: 16 },
  keeperBanner: { backgroundColor: "#073642", borderRadius: 8, padding: 12, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: "#d4a017" },
  keeperText: { fontSize: 14, fontStyle: "italic" },
  flameContainer: { alignItems: "center", justifyContent: "center", flex: 1, marginVertical: 16 },
  flameEmoji: { fontSize: 64 },
  intensityLabel: { color: "#FF6B35", fontSize: 12, fontWeight: "700", marginTop: 8, letterSpacing: 2 },
  statsRow: { flexDirection: "row", justifyContent: "space-around", marginBottom: 16 },
  statBox: { alignItems: "center", backgroundColor: "#073642", borderRadius: 8, padding: 12, flex: 1, marginHorizontal: 4 },
  statValue: { color: "#ffffff", fontSize: 20, fontWeight: "bold" },
  statLabel: { color: "#839496", fontSize: 11, marginTop: 4 },
  surgeOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(212,160,23,0.9)", alignItems: "center", justifyContent: "center", zIndex: 100 },
  surgePoints: { color: "#ffffff", fontSize: 72, fontWeight: "900" },
  surgeLabel: { color: "#ffffff", fontSize: 24, fontWeight: "600", letterSpacing: 2 },
  surgeMessage: { color: "#ffffff", fontSize: 20, fontWeight: "700", marginTop: 16 },
  surgeButton: { marginTop: 32, backgroundColor: "rgba(255,255,255,0.2)", paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  surgeButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  promptCard: { backgroundColor: "#073642", borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: "#586e75" },
  promptHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  multiplier: { color: "#FF6B35", fontSize: 14, fontWeight: "bold", backgroundColor: "rgba(255,107,53,0.15)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  promptQuestion: { color: "#93a1a1", fontSize: 18, fontWeight: "600", textAlign: "center", marginBottom: 16 },
  promptButtons: { flexDirection: "row", gap: 12 },
  yesButton: { flex: 1, backgroundColor: "#FF6B35", paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  noButton: { flex: 1, backgroundColor: "#586e75", paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "bold" },
  startButton: { backgroundColor: "#FF6B35", paddingVertical: 16, borderRadius: 12, alignItems: "center", marginBottom: 24 },
  startButtonText: { color: "#ffffff", fontSize: 18, fontWeight: "bold" },
});

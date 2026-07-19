/**
 * Onboarding Screen — Three-step flow:
 *   Step 0: Jersey Grid → pick your team (Macro_Tribe)
 *   Step 1: Region Picker → pick your city (Sub_Tribe)
 *   Step 2: Social Login → Google, Discord, or email via Privy
 *
 * On completion: registers the fan, stores auth data, navigates to Campfire.
 * No blockchain terminology anywhere — feels like a standard sports app signup.
 */

import React, { useState, useCallback } from "react";
import { View, Text, Pressable, SafeAreaView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../stores/useAuthStore";
import { registerFan } from "../../lib/api";
import { JerseyGrid, type Team } from "../../components/onboarding/JerseyGrid";
import { RegionPicker, type Region } from "../../components/onboarding/RegionPicker";
import { SocialLoginButtons } from "../../components/onboarding/SocialLoginButtons";

// ─── Step Constants ──────────────────────────────────────────────────────────

const STEP_JERSEY = 0;
const STEP_REGION = 1;
const STEP_LOGIN = 2;

const STEP_LABELS = ["Team", "City", "Sign In"];

// ─── Component ───────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const router = useRouter();

  // ─── Local state ─────────────────────────────────────────────────────────

  const [step, setStep] = useState(STEP_JERSEY);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);

  // ─── Store actions ───────────────────────────────────────────────────────

  const setTribe = useAuthStore((s) => s.setTribe);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleTeamSelect = useCallback((team: Team) => {
    setSelectedTeam(team);
  }, []);

  const handleRegionSelect = useCallback((region: Region) => {
    setSelectedRegion(region);
  }, []);

  const handleNext = useCallback(() => {
    if (step === STEP_JERSEY && selectedTeam) {
      setStep(STEP_REGION);
    } else if (step === STEP_REGION && selectedRegion) {
      // Construct tribeId from team + region and persist
      const tribeId = `${selectedTeam!.id}-${selectedRegion.id}`;
      const tribeName = `${selectedTeam!.name} · ${selectedRegion.city}`;
      setTribe(tribeId, tribeName, selectedTeam!.name);
      setStep(STEP_LOGIN);
    }
  }, [step, selectedTeam, selectedRegion, setTribe]);

  const handleBack = useCallback(() => {
    if (step === STEP_REGION) {
      setStep(STEP_JERSEY);
      setSelectedRegion(null);
    } else if (step === STEP_LOGIN) {
      setStep(STEP_REGION);
    }
  }, [step]);

  const handleLoginSuccess = useCallback(() => {
    // Auth state is synced by AuthProvider → useAuthStore.
    // Navigate to Campfire.
    router.replace("/(main)/campfire");
  }, [router]);

  // ─── Derived values ──────────────────────────────────────────────────────

  const tribeLabel =
    selectedTeam && selectedRegion
      ? `${selectedTeam.name} · ${selectedRegion.city}`
      : undefined;

  const canProceed =
    (step === STEP_JERSEY && selectedTeam !== null) ||
    (step === STEP_REGION && selectedRegion !== null);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Progress indicator */}
      <View style={styles.progressContainer}>
        <View style={styles.dotsRow}>
          {STEP_LABELS.map((label, index) => (
            <View key={label} style={styles.dotGroup}>
              {/* Step dot */}
              <View
                style={[
                  styles.dot,
                  { backgroundColor: index <= step ? "#FF6B35" : "#073642" },
                ]}
              >
                <Text
                  style={[
                    styles.dotText,
                    { color: index <= step ? "#ffffff" : "#839496" },
                  ]}
                >
                  {index + 1}
                </Text>
              </View>
              {/* Connector line */}
              {index < STEP_LABELS.length - 1 && (
                <View
                  style={[
                    styles.connector,
                    { backgroundColor: index < step ? "#FF6B35" : "#586e75" },
                  ]}
                />
              )}
            </View>
          ))}
        </View>

        {/* Step labels */}
        <View style={styles.labelsRow}>
          {STEP_LABELS.map((label, index) => (
            <Text
              key={label}
              style={[
                styles.labelText,
                index === step
                  ? { color: "#FF6B35", fontWeight: "600" }
                  : { color: "#839496" },
              ]}
            >
              {label}
            </Text>
          ))}
        </View>
      </View>

      {/* Step content */}
      <View style={styles.content}>
        {step === STEP_JERSEY && (
          <JerseyGrid
            onSelect={handleTeamSelect}
            selectedTeamId={selectedTeam?.id}
          />
        )}

        {step === STEP_REGION && selectedTeam && (
          <RegionPicker
            teamId={selectedTeam.id}
            teamName={selectedTeam.name}
            onSelect={handleRegionSelect}
            selectedRegionId={selectedRegion?.id}
          />
        )}

        {step === STEP_LOGIN && (
          <SocialLoginButtons
            onLoginSuccess={handleLoginSuccess}
            tribeLabel={tribeLabel}
          />
        )}
      </View>

      {/* Bottom navigation buttons */}
      {step !== STEP_LOGIN && (
        <View style={styles.bottomNav}>
          {/* Back button */}
          {step > STEP_JERSEY && (
            <Pressable
              onPress={handleBack}
              style={styles.backButton}
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <Text style={styles.backButtonText}>Back</Text>
            </Pressable>
          )}

          {/* Next button */}
          <Pressable
            onPress={handleNext}
            disabled={!canProceed}
            style={[
              styles.nextButton,
              { backgroundColor: canProceed ? "#FF6B35" : "#073642" },
            ]}
            accessibilityLabel="Continue to next step"
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.nextButtonText,
                { color: canProceed ? "#ffffff" : "#839496" },
              ]}
            >
              Next
            </Text>
          </Pressable>
        </View>
      )}

      {/* Back button for login step */}
      {step === STEP_LOGIN && (
        <View style={styles.loginBackContainer}>
          <Pressable
            onPress={handleBack}
            style={styles.loginBackButton}
            accessibilityLabel="Go back to city selection"
            accessibilityRole="button"
          >
            <Text style={styles.loginBackText}>← Back to city selection</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#002b36",
  },
  progressContainer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  dotGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  dotText: {
    fontSize: 12,
    fontWeight: "bold",
  },
  connector: {
    width: 40,
    height: 2,
    marginHorizontal: 4,
  },
  labelsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  labelText: {
    fontSize: 12,
  },
  content: {
    flex: 1,
    paddingTop: 16,
  },
  bottomNav: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 8,
    flexDirection: "row",
    gap: 12,
  },
  backButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#586e75",
    alignItems: "center",
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#93a1a1",
  },
  nextButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  loginBackContainer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 8,
  },
  loginBackButton: {
    paddingVertical: 12,
    alignItems: "center",
  },
  loginBackText: {
    fontSize: 14,
    color: "#839496",
  },
});

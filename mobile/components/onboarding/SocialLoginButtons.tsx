/**
 * SocialLoginButtons — Social login options for onboarding step 3.
 *
 * Provides Google, Discord, and Email login via the Privy RN SDK.
 * The embedded wallet creation is completely invisible to the fan —
 * no crypto terminology, no wallet addresses, no private keys.
 * This looks and feels like a standard social auth experience.
 */

import React, { useState } from "react";
import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet } from "react-native";
import { useAuth } from "../../providers/AuthProvider";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SocialLoginButtonsProps {
  /** Called after a successful login (any provider) */
  onLoginSuccess?: () => void;
  /** The tribe label to display (e.g., "Brazil · Hyderabad") */
  tribeLabel?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SocialLoginButtons({
  onLoginSuccess,
  tribeLabel,
}: SocialLoginButtonsProps) {
  const { login, submitEmailCode, oAuthState, emailState } = useAuth();

  const [emailInput, setEmailInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [showEmailFlow, setShowEmailFlow] = useState(false);

  const isLoading =
    oAuthState?.status === "loading" ||
    emailState?.status === "sending-code" ||
    emailState?.status === "submitting-code";

  const awaitingCode = emailState?.status === "awaiting-code-input";

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleGoogleLogin = async () => {
    try {
      await login("google");
      onLoginSuccess?.();
    } catch {
      // Error is handled by the auth provider / state
    }
  };

  const handleDiscordLogin = async () => {
    try {
      await login("discord");
      onLoginSuccess?.();
    } catch {
      // Error is handled by the auth provider / state
    }
  };

  const handleEmailStart = async () => {
    if (!emailInput.trim()) return;
    try {
      await login("email", emailInput.trim());
    } catch {
      // Error is handled by the auth provider / state
    }
  };

  const handleEmailCode = async () => {
    if (!codeInput.trim()) return;
    try {
      await submitEmailCode(codeInput.trim());
      onLoginSuccess?.();
    } catch {
      // Error is handled by the auth provider / state
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Header */}
      <Text style={styles.title}>Join Your Tribe</Text>
      <Text style={styles.subtitle}>Sign in to start making predictions</Text>
      {tribeLabel && (
        <Text style={styles.tribeLabel}>{tribeLabel}</Text>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF6B35" />
          <Text style={styles.loadingText}>Signing you in...</Text>
        </View>
      )}

      {!isLoading && !showEmailFlow && (
        <View style={styles.buttonsContainer}>
          {/* Google */}
          <Pressable
            onPress={handleGoogleLogin}
            style={styles.googleButton}
            accessibilityLabel="Continue with Google"
            accessibilityRole="button"
          >
            <Text style={styles.buttonIcon}>🔵</Text>
            <Text style={styles.googleButtonText}>Continue with Google</Text>
          </Pressable>

          {/* Discord */}
          <Pressable
            onPress={handleDiscordLogin}
            style={styles.discordButton}
            accessibilityLabel="Continue with Discord"
            accessibilityRole="button"
          >
            <Text style={styles.buttonIcon}>🎮</Text>
            <Text style={styles.discordButtonText}>Continue with Discord</Text>
          </Pressable>

          {/* Email */}
          <Pressable
            onPress={() => setShowEmailFlow(true)}
            style={styles.emailButton}
            accessibilityLabel="Continue with Email"
            accessibilityRole="button"
          >
            <Text style={styles.buttonIcon}>✉️</Text>
            <Text style={styles.emailButtonText}>Continue with Email</Text>
          </Pressable>
        </View>
      )}

      {/* Email flow: enter email */}
      {!isLoading && showEmailFlow && !awaitingCode && (
        <View style={styles.buttonsContainer}>
          <TextInput
            style={styles.textInput}
            placeholder="Enter your email"
            placeholderTextColor="#586e75"
            value={emailInput}
            onChangeText={setEmailInput}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            accessibilityLabel="Email address"
          />
          <Pressable
            onPress={handleEmailStart}
            style={styles.flameButton}
            accessibilityLabel="Send login code"
            accessibilityRole="button"
          >
            <Text style={styles.flameButtonText}>Send Login Code</Text>
          </Pressable>
          <Pressable
            onPress={() => setShowEmailFlow(false)}
            style={styles.backLink}
            accessibilityLabel="Back to login options"
            accessibilityRole="button"
          >
            <Text style={styles.backLinkText}>← Back to options</Text>
          </Pressable>
        </View>
      )}

      {/* Email flow: enter code */}
      {!isLoading && awaitingCode && (
        <View style={styles.buttonsContainer}>
          <Text style={styles.codeInstructions}>
            We sent a code to your email. Enter it below.
          </Text>
          <TextInput
            style={[styles.textInput, styles.codeInput]}
            placeholder="Enter code"
            placeholderTextColor="#586e75"
            value={codeInput}
            onChangeText={setCodeInput}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            accessibilityLabel="Verification code"
          />
          <Pressable
            onPress={handleEmailCode}
            style={styles.flameButton}
            accessibilityLabel="Verify code and sign in"
            accessibilityRole="button"
          >
            <Text style={styles.flameButtonText}>Verify & Join</Text>
          </Pressable>
        </View>
      )}

      {/* Footer note */}
      <Text style={styles.footer}>
        By continuing, you agree to our Terms of Service and Privacy Policy
      </Text>
    </View>
  );
}

export default SocialLoginButtons;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
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
    marginBottom: 8,
  },
  tribeLabel: {
    fontSize: 14,
    color: "#FF6B35",
    textAlign: "center",
    marginBottom: 32,
    fontWeight: "600",
  },
  loadingContainer: {
    alignItems: "center",
    marginBottom: 24,
  },
  loadingText: {
    color: "#839496",
    marginTop: 8,
  },
  buttonsContainer: {
    gap: 16,
  },
  googleButton: {
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2937",
  },
  discordButton: {
    backgroundColor: "#5865F2",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  discordButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
  emailButton: {
    backgroundColor: "#073642",
    borderWidth: 1,
    borderColor: "#586e75",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  emailButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#93a1a1",
  },
  buttonIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  textInput: {
    backgroundColor: "#073642",
    borderWidth: 1,
    borderColor: "#586e75",
    color: "#93a1a1",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 12,
    fontSize: 16,
  },
  codeInput: {
    textAlign: "center",
    letterSpacing: 4,
  },
  flameButton: {
    backgroundColor: "#FF6B35",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  flameButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
  backLink: {
    alignItems: "center",
    paddingVertical: 8,
  },
  backLinkText: {
    fontSize: 14,
    color: "#839496",
  },
  codeInstructions: {
    fontSize: 14,
    color: "#839496",
    textAlign: "center",
  },
  footer: {
    fontSize: 12,
    color: "#839496",
    textAlign: "center",
    marginTop: 32,
  },
});

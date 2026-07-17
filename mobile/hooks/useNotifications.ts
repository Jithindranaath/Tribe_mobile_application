/**
 * TRIBE Mobile App — Push Notification Registration & Handling
 *
 * Handles:
 * - Requesting notification permissions with contextual explanation
 * - Registering the device push token with the server
 * - Navigating to the Campfire screen when a notification is tapped
 * - Processing notifications received while the app is foregrounded
 *
 * Requirements: 12.1, 12.2, 12.3
 */

import { useEffect, useRef, useCallback } from 'react';
import { Platform, Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { EventSubscription } from 'expo-modules-core';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../stores/useAuthStore';
import { useSettingsStore } from '../stores/useSettingsStore';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Expected notification data payload from server push */
export interface NotificationData {
  fixtureId: string;
  type: 'read_prompt';
}

// ─── Configuration ───────────────────────────────────────────────────────────

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Configure how notifications appear when the app is in the foreground.
 * We show an alert banner so the fan sees the read prompt immediately.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─── Push Token Registration ─────────────────────────────────────────────────

/**
 * Registers the Expo push token with the TRIBE server so the server can
 * send push notifications for read_prompt events when the app is backgrounded.
 */
async function registerTokenWithServer(
  expoPushToken: string,
  authToken: string | null,
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    await fetch(`${BASE_URL}/api/notifications/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ pushToken: expoPushToken, platform: Platform.OS }),
    });
  } catch (error) {
    // Silent failure — token registration is best-effort.
    // The server will retry on next app open if needed.
    console.warn('[Notifications] Failed to register push token:', error);
  }
}

// ─── Permission Request ──────────────────────────────────────────────────────

/**
 * Requests notification permissions from the user.
 * Shows a contextual explanation before the system prompt so the fan
 * understands why notifications are valuable (requirement 12.3).
 *
 * @returns The Expo push token string, or null if permissions denied.
 */
export async function requestNotificationPermissions(): Promise<string | null> {
  // Push notifications require a physical device on iOS.
  // On Android emulators they may work with FCM but we skip gracefully on web.
  if (Platform.OS === 'web') {
    console.warn('[Notifications] Push notifications are not supported on web');
    return null;
  }

  // Check existing permission status
  const { status: existingStatus } = await Notifications.getPermissionsAsync();

  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    // Show contextual explanation before requesting
    await new Promise<void>((resolve) => {
      Alert.alert(
        'Stay in the Game',
        'TRIBE sends notifications when a Read prompt fires during live matches so you never miss a prediction opportunity. You can turn these off anytime in Settings.',
        [{ text: 'Got it', onPress: () => resolve() }],
      );
    });

    // Request permissions after explanation
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  // Get the Expo push token
  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: 'tribe-mobile',
  });

  return tokenData.data;
}

// ─── Android Channel Setup ───────────────────────────────────────────────────

/**
 * Sets up the notification channel on Android (required for Android 8+).
 */
async function setupAndroidChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('read-prompts', {
      name: 'Read Prompts',
      description: 'Notifications for live match prediction prompts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#d4a017',
    });
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Hook that manages push notification lifecycle:
 * 1. On mount: checks/requests permissions and registers push token
 * 2. Listens for notification taps and navigates to the relevant Campfire
 * 3. Handles foreground notifications (shows in-app alert via handler)
 *
 * Should be mounted once in the root layout.
 */
export function useNotifications() {
  const router = useRouter();
  const notificationResponseListener = useRef<EventSubscription | null>(null);
  const notificationReceivedListener = useRef<EventSubscription | null>(null);

  /**
   * Handle notification tap: navigate to the relevant fixture's Campfire.
   */
  const handleNotificationTap = useCallback(
    (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content
        .data as unknown as NotificationData;

      if (data?.fixtureId && data?.type === 'read_prompt') {
        // Navigate to the Campfire for this fixture
        router.push({
          pathname: '/(match)/[fixtureId]',
          params: { fixtureId: data.fixtureId },
        } as any);
      }
    },
    [router],
  );

  useEffect(() => {
    let isMounted = true;

    async function initialize() {
      // Set up Android notification channel
      await setupAndroidChannel();

      // Request permissions and get push token
      const token = await requestNotificationPermissions();

      if (!isMounted) return;

      if (token) {
        // Register token with the server
        const authToken = useAuthStore.getState().token;
        await registerTokenWithServer(token, authToken);

        // Update settings store to reflect enabled state
        useSettingsStore.getState().setNotificationsEnabled(true);
      } else {
        useSettingsStore.getState().setNotificationsEnabled(false);
      }
    }

    initialize();

    // Listen for notification taps (user interacting with a notification)
    notificationResponseListener.current =
      Notifications.addNotificationResponseReceivedListener(handleNotificationTap);

    // Listen for notifications received while app is in foreground
    notificationReceivedListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        // The handler config above shows the alert automatically.
        // Additional in-app handling could be added here if needed.
        const data = notification.request.content.data as unknown as NotificationData;
        if (data?.type === 'read_prompt') {
          // Could trigger an in-app indicator or sound
          // For now, the system notification handler shows the alert
        }
      });

    return () => {
      isMounted = false;
      if (notificationResponseListener.current) {
        notificationResponseListener.current.remove();
      }
      if (notificationReceivedListener.current) {
        notificationReceivedListener.current.remove();
      }
    };
  }, [handleNotificationTap]);
}

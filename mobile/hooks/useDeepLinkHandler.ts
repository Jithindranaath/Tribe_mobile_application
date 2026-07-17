/**
 * TRIBE Mobile App — Deep Link Handler Hook
 *
 * Listens for incoming deep links and navigates to the appropriate screen
 * using the resolveDeepLink utility. Handles both cold-start and warm-start
 * deep links.
 *
 * Requirements: 8.4
 */

import { useEffect, useCallback } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { resolveDeepLink } from '../lib/deepLinking';
import { useCampfireStore } from '../stores/useCampfireStore';

/**
 * Hook that subscribes to incoming deep links and routes them appropriately.
 * Should be mounted once in the root layout.
 */
export function useDeepLinkHandler() {
  const router = useRouter();

  const handleDeepLink = useCallback(
    (url: string) => {
      const resolved = resolveDeepLink(url);

      if (resolved.errorReason) {
        // Invalid deep link: navigate home and show a toast/alert
        router.replace('/');
        // Use a brief timeout so navigation completes before showing alert
        setTimeout(() => {
          Alert.alert(
            'Invalid Link',
            'This link could not be opened. Returning to home.',
          );
        }, 300);
        return;
      }

      // Navigate to the resolved path with params
      if (resolved.path === '/(match)/[fixtureId]') {
        router.push({
          pathname: '/(match)/[fixtureId]',
          params: resolved.params,
        } as any);
      } else if (resolved.path === '/(match)/replay/[fixtureId]') {
        router.push({
          pathname: '/(match)/replay/[fixtureId]',
          params: resolved.params,
        } as any);
      } else if (resolved.path === '/(main)/campfire') {
        // Set tribe context or share modal state in the store
        if (resolved.params.tribeId) {
          // Set tribe context for campfire - the screen will pick this up
          useCampfireStore.getState().setTribeContext?.(resolved.params.tribeId);
        }
        if (resolved.showShareModal && resolved.params.cardId) {
          // Set share card state so the modal opens
          useCampfireStore.getState().setShareCardFromDeepLink?.(resolved.params.cardId);
        }
        router.push('/(main)/campfire' as any);
      } else {
        // Fallback to home
        router.replace('/');
      }
    },
    [router],
  );

  useEffect(() => {
    // Handle deep links that opened the app (cold start)
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink(url);
      }
    });

    // Handle deep links while app is running (warm start)
    const subscription = Linking.addEventListener('url', (event) => {
      handleDeepLink(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, [handleDeepLink]);
}

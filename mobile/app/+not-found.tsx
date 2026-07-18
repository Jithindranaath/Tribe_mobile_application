import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, Alert } from 'react-native';
import { Text, View } from 'react-native';

/**
 * Not Found Screen
 *
 * Handles unmatched routes, including invalid deep links.
 * Shows a brief message and navigates back to home with a toast.
 *
 * Requirements: 8.4 (handle invalid deep links by navigating to home with toast)
 */
export default function NotFoundScreen() {
  const router = useRouter();

  useEffect(() => {
    // Navigate to home after a brief delay, showing a toast
    const timer = setTimeout(() => {
      Alert.alert(
        'Invalid Link',
        'This link could not be opened. Returning to home.',
      );
      router.replace('/');
    }, 500);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <>
      <Stack.Screen options={{ title: 'Not Found' }} />
      <View style={styles.container}>
        <Text style={styles.title}>This screen doesn't exist.</Text>
        <Text style={styles.subtitle}>Redirecting to home...</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#002b36',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  subtitle: {
    marginTop: 10,
    fontSize: 14,
    color: '#93a1a1',
  },
});

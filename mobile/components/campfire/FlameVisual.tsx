import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import LottieView from 'lottie-react-native';
import { useCampfireStore } from '../../stores/useCampfireStore';
import type { FlameIntensity } from '../../types';

// ─── Lottie source map ────────────────────────────────────────────────────────

const LOTTIE_SOURCES: Record<FlameIntensity, any> = {
  dim: require('../../assets/lottie/flame_dim.json'),
  steady: require('../../assets/lottie/flame_steady.json'),
  bright: require('../../assets/lottie/flame_bright.json'),
  blazing: require('../../assets/lottie/flame_blazing.json'),
};

// ─── Speed calculation ────────────────────────────────────────────────────────

/**
 * Computes Lottie playback speed based on the exact conviction signal
 * within the current tier.
 *
 * Each tier spans 25 points of signal:
 *   dim:     0–25
 *   steady:  26–50
 *   bright:  51–75
 *   blazing: 76–100
 *
 * Speed ranges from 0.6x (bottom of tier) to 1.4x (top of tier),
 * linearly interpolated by position within the tier.
 */
function computeSpeed(signal: number, intensity: FlameIntensity): number {
  const TIER_RANGES: Record<FlameIntensity, [number, number]> = {
    dim: [0, 25],
    steady: [26, 50],
    bright: [51, 75],
    blazing: [76, 100],
  };

  const [min, max] = TIER_RANGES[intensity];
  const clamped = Math.max(min, Math.min(max, signal));
  const normalized = max > min ? (clamped - min) / (max - min) : 0;

  // Map normalized [0,1] to speed [0.6, 1.4]
  return 0.6 + normalized * 0.8;
}

// ─── Crossfade duration ───────────────────────────────────────────────────────

const CROSSFADE_DURATION = 400; // ms

// ─── Component ────────────────────────────────────────────────────────────────

export function FlameVisual() {
  const flameIntensity = useCampfireStore((s) => s.flameIntensity);
  const conviction = useCampfireStore((s) => s.conviction);

  const signal = conviction?.signal ?? 0;
  const speed = computeSpeed(signal, flameIntensity);

  // Track previous intensity to manage crossfade
  const prevIntensityRef = useRef<FlameIntensity>(flameIntensity);

  // Reanimated shared values for UI-thread crossfade at 60fps
  const currentOpacity = useSharedValue(1);
  const prevOpacity = useSharedValue(0);

  // Previous intensity for the fading-out layer
  const [fadingOutIntensity, setFadingOutIntensity] = React.useState<FlameIntensity | null>(null);

  // Lottie refs for controlling speed
  const currentLottieRef = useRef<LottieView>(null);
  const prevLottieRef = useRef<LottieView>(null);

  useEffect(() => {
    if (prevIntensityRef.current !== flameIntensity) {
      // Intensity tier changed — trigger crossfade
      setFadingOutIntensity(prevIntensityRef.current);
      prevIntensityRef.current = flameIntensity;

      // Reset opacities for crossfade
      currentOpacity.value = 0;
      prevOpacity.value = 1;

      // Animate: fade in new tier, fade out old tier (runs on UI thread)
      currentOpacity.value = withTiming(1, {
        duration: CROSSFADE_DURATION,
        easing: Easing.out(Easing.cubic),
      });
      prevOpacity.value = withTiming(0, {
        duration: CROSSFADE_DURATION,
        easing: Easing.out(Easing.cubic),
      });

      // After crossfade completes, clear the fading-out layer
      const timer = setTimeout(() => {
        setFadingOutIntensity(null);
      }, CROSSFADE_DURATION);

      return () => clearTimeout(timer);
    }
  }, [flameIntensity, currentOpacity, prevOpacity]);

  // Worklet-based animated styles — run on native UI thread at 60fps
  const currentAnimatedStyle = useAnimatedStyle(() => {
    "worklet";
    return { opacity: currentOpacity.value };
  });

  const prevAnimatedStyle = useAnimatedStyle(() => {
    "worklet";
    return { opacity: prevOpacity.value };
  });

  return (
    <View style={styles.container}>
      {/* Fading-out layer (previous intensity) */}
      {fadingOutIntensity && (
        <Animated.View style={[styles.lottieWrapper, prevAnimatedStyle]}>
          <LottieView
            ref={prevLottieRef}
            source={LOTTIE_SOURCES[fadingOutIntensity]}
            autoPlay
            loop
            speed={speed}
            style={styles.lottie}
          />
        </Animated.View>
      )}

      {/* Current intensity layer */}
      <Animated.View style={[styles.lottieWrapper, currentAnimatedStyle]}>
        <LottieView
          ref={currentLottieRef}
          source={LOTTIE_SOURCES[flameIntensity]}
          autoPlay
          loop
          speed={speed}
          style={styles.lottie}
        />
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  lottieWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lottie: {
    width: 200,
    height: 200,
  },
});

export default FlameVisual;

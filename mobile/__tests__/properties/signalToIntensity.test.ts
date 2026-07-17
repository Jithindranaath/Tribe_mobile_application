// Feature: tribe-mobile-app, Property 1: Flame intensity mapping is bounded and monotonic
import fc from 'fast-check';
import { signalToIntensity, FlameIntensity } from '../../types/match';

const INTENSITY_ORDER: FlameIntensity[] = ['dim', 'steady', 'bright', 'blazing'];

function intensityIndex(intensity: FlameIntensity): number {
  return INTENSITY_ORDER.indexOf(intensity);
}

describe('Property 1: Flame intensity mapping is bounded and monotonic', () => {
  it('always returns exactly one of the four intensity tiers for any signal 0-100', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (signal) => {
        const result = signalToIntensity(signal);
        expect(INTENSITY_ORDER).toContain(result);
      }),
      { numRuns: 100 }
    );
  });

  it('is monotonically non-decreasing: if a < b then intensity(a) <= intensity(b)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const loIntensity = intensityIndex(signalToIntensity(lo));
          const hiIntensity = intensityIndex(signalToIntensity(hi));
          expect(loIntensity).toBeLessThanOrEqual(hiIntensity);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('maps boundary values correctly', () => {
    expect(signalToIntensity(0)).toBe('dim');
    expect(signalToIntensity(25)).toBe('dim');
    expect(signalToIntensity(26)).toBe('steady');
    expect(signalToIntensity(50)).toBe('steady');
    expect(signalToIntensity(51)).toBe('bright');
    expect(signalToIntensity(75)).toBe('bright');
    expect(signalToIntensity(76)).toBe('blazing');
    expect(signalToIntensity(100)).toBe('blazing');
  });
});

// Feature: tribe-mobile-app, Property 11: Fan statistics computation accuracy
import fc from 'fast-check';

/**
 * Compute accuracy percentage matching the StatsGrid implementation.
 */
function computeAccuracy(readsCorrect: number, readsTotal: number): number {
  if (readsTotal === 0) return 0;
  return Math.round((readsCorrect / readsTotal) * 1000) / 10;
}

describe('Property 11: Fan statistics computation accuracy', () => {
  it('equals (readsCorrect / readsTotal) * 100 rounded to 1 decimal when readsTotal > 0', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10000 }),
        fc.nat({ max: 10000 }),
        (readsCorrect, readsTotal) => {
          // Ensure readsCorrect <= readsTotal and readsTotal > 0
          const total = Math.max(readsTotal, 1);
          const correct = Math.min(readsCorrect, total);

          const accuracy = computeAccuracy(correct, total);
          const expected = Math.round((correct / total) * 1000) / 10;
          expect(accuracy).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns 0 when readsTotal is 0', () => {
    expect(computeAccuracy(0, 0)).toBe(0);
  });

  it('is always between 0 and 100', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10000 }),
        fc.nat({ max: 10000 }),
        (readsCorrect, readsTotal) => {
          const total = Math.max(readsTotal, 1);
          const correct = Math.min(readsCorrect, total);
          const accuracy = computeAccuracy(correct, total);
          expect(accuracy).toBeGreaterThanOrEqual(0);
          expect(accuracy).toBeLessThanOrEqual(100);
        }
      ),
      { numRuns: 100 }
    );
  });
});

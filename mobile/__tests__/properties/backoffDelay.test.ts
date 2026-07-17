// Feature: tribe-mobile-app, Property 4: Exponential backoff delay computation
import fc from 'fast-check';
import { getBackoffDelay, BACKOFF_SCHEDULE } from '../../hooks/useCampfireSocket';

describe('Property 4: Exponential backoff delay computation', () => {
  it('returns BACKOFF_SCHEDULE[n] for any attempt index 0-3', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), (attempt) => {
        const delay = getBackoffDelay(attempt);
        expect(delay).toBe(BACKOFF_SCHEDULE[attempt]);
      }),
      { numRuns: 100 }
    );
  });

  it('delays are 1000, 2000, 4000, 8000 ms respectively', () => {
    expect(getBackoffDelay(0)).toBe(1000);
    expect(getBackoffDelay(1)).toBe(2000);
    expect(getBackoffDelay(2)).toBe(4000);
    expect(getBackoffDelay(3)).toBe(8000);
  });

  it('returns last schedule value for out-of-range attempts', () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 100 }), (attempt) => {
        const delay = getBackoffDelay(attempt);
        expect(delay).toBe(BACKOFF_SCHEDULE[BACKOFF_SCHEDULE.length - 1]);
      }),
      { numRuns: 100 }
    );
  });
});

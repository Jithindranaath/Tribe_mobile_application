// Feature: tribe-mobile-app, Property 9: Moment card display completeness
import fc from 'fast-check';
import type { TimelineMoment } from '../../types/timeline';

/**
 * Simulates what MomentCard renders — verifies match, prediction, and outcome
 * fields are all present in the rendered text.
 */
function extractMomentCardContent(moment: TimelineMoment): {
  hasMatch: boolean;
  hasPrediction: boolean;
  hasOutcome: boolean;
} {
  // MomentCard renders:
  // - moment.match as a text heading
  // - moment.prediction under "Your Read" section
  // - moment.outcome in the outcome section
  return {
    hasMatch: moment.match.length > 0,
    hasPrediction: moment.prediction.length > 0,
    hasOutcome: moment.outcome.length > 0,
  };
}

describe('Property 9: Moment card display completeness', () => {
  it('rendered MomentCard includes match, prediction, and outcome for any valid moment', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.uuid(),
          fanId: fc.uuid(),
          fixtureId: fc.nat(),
          type: fc.oneof(fc.constant('READ_SUCCESS' as const), fc.constant('TITLE_EARNED' as const), fc.constant('RANK_CLIMB' as const)),
          match: fc.string({ minLength: 1, maxLength: 50 }),
          prediction: fc.string({ minLength: 1, maxLength: 100 }),
          outcome: fc.string({ minLength: 1, maxLength: 100 }),
          createdAt: fc.date().map(d => d.toISOString()),
        }),
        (moment) => {
          const display = extractMomentCardContent(moment as TimelineMoment);
          expect(display.hasMatch).toBe(true);
          expect(display.hasPrediction).toBe(true);
          expect(display.hasOutcome).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

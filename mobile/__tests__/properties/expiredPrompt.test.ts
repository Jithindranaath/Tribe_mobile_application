// Feature: tribe-mobile-app, Property 2: Expired Read prompts are dismissed
import fc from 'fast-check';
import { useCampfireStore } from '../../stores/useCampfireStore';

describe('Property 2: Expired Read prompts are dismissed', () => {
  beforeEach(() => {
    useCampfireStore.setState({
      activePrompt: null,
      committedReadIds: new Set<string>(),
      pendingReads: new Map(),
    });
  });

  it('activePrompt is null after dismissPrompt for any expired prompt', () => {
    fc.assert(
      fc.property(
        fc.record({
          readId: fc.uuid(),
          question: fc.string({ minLength: 1 }),
          multiplier: fc.float({ min: 1, max: 5, noNaN: true }),
          expiresAt: fc.integer({ min: 0, max: Date.now() }), // already expired
        }),
        (promptData) => {
          // Set up an expired prompt
          useCampfireStore.setState({
            activePrompt: {
              readId: promptData.readId,
              question: promptData.question,
              options: ['YES', 'NO'],
              multiplier: promptData.multiplier,
              expiresAt: promptData.expiresAt,
              readType: 'moment_read',
            },
          });

          // Simulate expiration check: if now >= expiresAt, dismiss
          const now = Date.now();
          if (now >= promptData.expiresAt) {
            useCampfireStore.getState().dismissPrompt();
          }

          // activePrompt should be null after dismissal
          expect(useCampfireStore.getState().activePrompt).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});

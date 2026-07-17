// Feature: tribe-mobile-app, Property 6: Duplicate read commit prevention
import fc from 'fast-check';
import { useCampfireStore } from '../../stores/useCampfireStore';

// Reset store before each test
beforeEach(() => {
  useCampfireStore.setState({
    committedReadIds: new Set<string>(),
    pendingReads: new Map(),
    activePrompt: null,
  });
});

describe('Property 6: Duplicate read commit prevention', () => {
  it('rejects duplicate commits without changing state', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.oneof(fc.constant(0), fc.constant(1)),
        (readId, predicted) => {
          // Reset store
          useCampfireStore.setState({
            committedReadIds: new Set<string>(),
            pendingReads: new Map(),
            activePrompt: { readId, question: 'Test?', options: ['YES', 'NO'], multiplier: 1, expiresAt: Date.now() + 30000, readType: 'moment_read' },
          });

          // First commit should succeed
          useCampfireStore.getState().commitRead(readId, predicted);
          const afterFirst = useCampfireStore.getState();
          expect(afterFirst.committedReadIds.has(readId)).toBe(true);
          expect(afterFirst.pendingReads.has(readId)).toBe(true);

          // Capture state after first commit
          const committedSizeAfterFirst = afterFirst.committedReadIds.size;
          const pendingSizeAfterFirst = afterFirst.pendingReads.size;

          // Second commit (duplicate) should be a no-op
          useCampfireStore.getState().commitRead(readId, predicted);
          const afterSecond = useCampfireStore.getState();
          expect(afterSecond.committedReadIds.size).toBe(committedSizeAfterFirst);
          expect(afterSecond.pendingReads.size).toBe(pendingSizeAfterFirst);
        }
      ),
      { numRuns: 100 }
    );
  });
});

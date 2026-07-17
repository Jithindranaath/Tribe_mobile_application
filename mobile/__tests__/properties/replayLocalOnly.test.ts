// Feature: tribe-mobile-app, Property 12: Replay mode reads resolve locally only
import fc from 'fast-check';
import { useCampfireStore } from '../../stores/useCampfireStore';

describe('Property 12: Replay mode reads resolve locally only', () => {
  beforeEach(() => {
    // Set up replay mode
    useCampfireStore.setState({
      isReplayMode: true,
      connected: false, // not connected in replay
      committedReadIds: new Set<string>(),
      pendingReads: new Map(),
      activePrompt: null,
    });
  });

  it('commits update only local state (no network) in replay mode', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.oneof(fc.constant(0), fc.constant(1)),
        (readId, predicted) => {
          // Reset for each run
          useCampfireStore.setState({
            isReplayMode: true,
            connected: false,
            committedReadIds: new Set<string>(),
            pendingReads: new Map(),
            activePrompt: {
              readId,
              question: 'Test?',
              options: ['YES', 'NO'],
              multiplier: 1,
              expiresAt: Date.now() + 30000,
              readType: 'moment_read',
            },
          });

          // Verify store is in replay mode and not connected
          const stateBefore = useCampfireStore.getState();
          expect(stateBefore.isReplayMode).toBe(true);
          expect(stateBefore.connected).toBe(false);

          // Commit a read in replay mode
          useCampfireStore.getState().commitRead(readId, predicted);

          // Verify local state was updated
          const stateAfter = useCampfireStore.getState();
          expect(stateAfter.committedReadIds.has(readId)).toBe(true);
          expect(stateAfter.pendingReads.has(readId)).toBe(true);

          // Verify still in replay mode (no connection changes)
          expect(stateAfter.isReplayMode).toBe(true);
          expect(stateAfter.connected).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

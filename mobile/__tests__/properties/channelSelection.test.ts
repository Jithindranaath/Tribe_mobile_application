// Feature: tribe-mobile-app, Property 5: Read commit channel selection
import fc from 'fast-check';
import { getCommitChannel } from '../../lib/api';

describe('Property 5: Read commit channel selection', () => {
  it('returns websocket when connected is true, rest when false', () => {
    fc.assert(
      fc.property(fc.boolean(), (connected) => {
        const channel = getCommitChannel(connected);
        if (connected) {
          expect(channel).toBe('websocket');
        } else {
          expect(channel).toBe('rest');
        }
      }),
      { numRuns: 100 }
    );
  });
});

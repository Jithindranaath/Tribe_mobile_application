// Feature: tribe-mobile-app, Property 14: Read commit message schema validity
import fc from 'fast-check';
import { buildCommitMessage } from '../../lib/api';

describe('Property 14: Read commit message schema validity', () => {
  it('produces a valid ReadCommitMessage for any readId and predicted value', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.oneof(fc.constant(0), fc.constant(1)),
        fc.uuid(),
        (readId, predicted, fanId) => {
          const message = buildCommitMessage(readId, predicted, fanId);

          // type must be 'read_commit'
          expect(message.type).toBe('read_commit');

          // payload must have exactly readId, predicted, fanId, timestamp
          expect(message.payload.readId).toBe(readId);
          expect(message.payload.predicted).toBe(predicted);
          expect(message.payload.fanId).toBe(fanId);

          // timestamp must be a positive integer (ms since epoch)
          expect(typeof message.payload.timestamp).toBe('number');
          expect(message.payload.timestamp).toBeGreaterThan(0);
          expect(Number.isInteger(message.payload.timestamp)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

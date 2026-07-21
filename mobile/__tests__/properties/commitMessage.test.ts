// Feature: tribe-mobile-app, Property 14: Read commit message schema validity
import fc from 'fast-check';
import { buildCommitMessage } from '../../lib/api';

describe('Property 14: Read commit message schema validity', () => {
  it('produces a valid ReadCommitMessage for any readId and predicted value', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.oneof(fc.constant(0), fc.constant(1)),
        (readId, predicted) => {
          const message = buildCommitMessage(readId, predicted);

          // type must be 'read_commit'
          expect(message.type).toBe('read_commit');

          // Flat shape — must match the server's real ClientReadCommitMessage
          // (server/src/ws/types.ts) exactly: {type, readId, predicted}. The
          // server derives fanId/fixtureId from the authenticated connection,
          // not the message body — a previous version of this message (and
          // this test) used a nested `payload: {...}` shape that the server
          // never actually understood, so every WS-channel commit was
          // silently dropped.
          expect(message.readId).toBe(readId);
          expect(message.predicted).toBe(predicted);
          expect('payload' in message).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

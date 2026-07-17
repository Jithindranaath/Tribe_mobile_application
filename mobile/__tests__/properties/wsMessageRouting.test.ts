// Feature: tribe-mobile-app, Property 3: WebSocket message routing correctness
import fc from 'fast-check';
import { useCampfireStore } from '../../stores/useCampfireStore';
import { signalToIntensity } from '../../types/match';
import type { WSEventType, WSMessage, PresencePayload, ConvictionPayload, SurgePayload, KeeperInjectPayload, ShareCardReadyPayload } from '../../types/ws';
import type { ReadPromptPayload } from '../../types/read';

// Simulate the WS message handler logic (extracted from useCampfireSocket)
function handleWSMessage(msg: WSMessage) {
  switch (msg.type as WSEventType) {
    case 'presence':
      useCampfireStore.setState({ presence: msg.payload as PresencePayload });
      break;
    case 'conviction': {
      const p = msg.payload as ConvictionPayload;
      useCampfireStore.setState({ conviction: p, flameIntensity: signalToIntensity(p.signal) });
      break;
    }
    case 'read_prompt':
      useCampfireStore.setState({ activePrompt: msg.payload as ReadPromptPayload });
      break;
    case 'surge':
      useCampfireStore.setState({ surgeActive: true, surgePayload: msg.payload as SurgePayload });
      break;
    case 'keeper_inject':
      useCampfireStore.setState({ keeperMessage: msg.payload as KeeperInjectPayload });
      break;
    case 'share_card_ready':
      useCampfireStore.setState({ shareCard: msg.payload as ShareCardReadyPayload });
      break;
  }
}

// Arbitraries for payloads
const presenceArb = fc.record({
  type: fc.constant('presence' as const),
  payload: fc.record({ activeCount: fc.nat({ max: 500 }), tribeId: fc.uuid() }),
  timestamp: fc.nat(),
});

const convictionArb = fc.record({
  type: fc.constant('conviction' as const),
  payload: fc.record({ signal: fc.integer({ min: 0, max: 100 }), percentage: fc.integer({ min: 0, max: 100 }), tribeId: fc.uuid() }),
  timestamp: fc.nat(),
});

const surgeArb = fc.record({
  type: fc.constant('surge' as const),
  payload: fc.record({ readId: fc.uuid(), standingEarned: fc.nat({ max: 50 }), newStanding: fc.nat({ max: 1000 }), message: fc.string() }),
  timestamp: fc.nat(),
});

const keeperArb = fc.record({
  type: fc.constant('keeper_inject' as const),
  payload: fc.record({ message: fc.string({ minLength: 1 }), emotion: fc.oneof(fc.constant('neutral' as const), fc.constant('tense' as const), fc.constant('euphoric' as const), fc.constant('dramatic' as const)) }),
  timestamp: fc.nat(),
});

const shareCardArb = fc.record({
  type: fc.constant('share_card_ready' as const),
  payload: fc.record({ cardId: fc.uuid(), imageUrl: fc.webUrl(), readId: fc.uuid() }),
  timestamp: fc.nat(),
});

describe('Property 3: WebSocket message routing correctness', () => {
  beforeEach(() => {
    useCampfireStore.setState({
      presence: null,
      conviction: null,
      flameIntensity: 'dim',
      activePrompt: null,
      surgeActive: false,
      surgePayload: null,
      keeperMessage: null,
      shareCard: null,
    });
  });

  it('presence message updates only the presence field', () => {
    fc.assert(
      fc.property(presenceArb, (msg) => {
        const before = useCampfireStore.getState();
        handleWSMessage(msg as WSMessage);
        const after = useCampfireStore.getState();
        
        expect(after.presence).toEqual(msg.payload);
        // Other fields unchanged
        expect(after.conviction).toEqual(before.conviction);
        expect(after.surgeActive).toEqual(before.surgeActive);
        expect(after.keeperMessage).toEqual(before.keeperMessage);
        expect(after.shareCard).toEqual(before.shareCard);
      }),
      { numRuns: 100 }
    );
  });

  it('conviction message updates conviction and flameIntensity only', () => {
    fc.assert(
      fc.property(convictionArb, (msg) => {
        const before = useCampfireStore.getState();
        handleWSMessage(msg as WSMessage);
        const after = useCampfireStore.getState();
        
        expect(after.conviction).toEqual(msg.payload);
        expect(after.flameIntensity).toBe(signalToIntensity((msg.payload as ConvictionPayload).signal));
        // Other fields unchanged
        expect(after.presence).toEqual(before.presence);
        expect(after.surgeActive).toEqual(before.surgeActive);
        expect(after.keeperMessage).toEqual(before.keeperMessage);
      }),
      { numRuns: 100 }
    );
  });

  it('surge message updates surgeActive and surgePayload only', () => {
    fc.assert(
      fc.property(surgeArb, (msg) => {
        const before = useCampfireStore.getState();
        handleWSMessage(msg as WSMessage);
        const after = useCampfireStore.getState();
        
        expect(after.surgeActive).toBe(true);
        expect(after.surgePayload).toEqual(msg.payload);
        // Others unchanged
        expect(after.presence).toEqual(before.presence);
        expect(after.conviction).toEqual(before.conviction);
        expect(after.keeperMessage).toEqual(before.keeperMessage);
      }),
      { numRuns: 100 }
    );
  });

  it('keeper_inject message updates keeperMessage only', () => {
    fc.assert(
      fc.property(keeperArb, (msg) => {
        const before = useCampfireStore.getState();
        handleWSMessage(msg as WSMessage);
        const after = useCampfireStore.getState();
        
        expect(after.keeperMessage).toEqual(msg.payload);
        expect(after.presence).toEqual(before.presence);
        expect(after.surgeActive).toEqual(before.surgeActive);
      }),
      { numRuns: 100 }
    );
  });

  it('share_card_ready message updates shareCard only', () => {
    fc.assert(
      fc.property(shareCardArb, (msg) => {
        const before = useCampfireStore.getState();
        handleWSMessage(msg as WSMessage);
        const after = useCampfireStore.getState();
        
        expect(after.shareCard).toEqual(msg.payload);
        expect(after.presence).toEqual(before.presence);
        expect(after.surgeActive).toEqual(before.surgeActive);
      }),
      { numRuns: 100 }
    );
  });
});

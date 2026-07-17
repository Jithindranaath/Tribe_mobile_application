// Feature: tribe-mobile-app, Property 8: Deep link routing resolves to correct screen
import fc from 'fast-check';
import { resolveDeepLink, parseDeepLink } from '../../lib/deepLinking';

// Generate alphanumeric strings (valid path segments) for fast-check v4
const alphaNumChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const idArb = fc.string({ minLength: 1, maxLength: 20 }).filter(s => {
  return s.length > 0 && [...s].every(c => alphaNumChars.includes(c));
});

describe('Property 8: Deep link routing resolves to correct screen', () => {
  it('tribe://campfire/:fixtureId resolves to (match)/[fixtureId] with correct params', () => {
    fc.assert(
      fc.property(idArb, (fixtureId) => {
        const url = `tribe://campfire/${fixtureId}`;
        const resolved = resolveDeepLink(url);
        expect(resolved.path).toBe('/(match)/[fixtureId]');
        expect(resolved.params.fixtureId).toBe(fixtureId);
        expect(resolved.showShareModal).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('tribe://replay/:fixtureId resolves to (match)/replay/[fixtureId]', () => {
    fc.assert(
      fc.property(idArb, (fixtureId) => {
        const url = `tribe://replay/${fixtureId}`;
        const resolved = resolveDeepLink(url);
        expect(resolved.path).toBe('/(match)/replay/[fixtureId]');
        expect(resolved.params.fixtureId).toBe(fixtureId);
      }),
      { numRuns: 100 }
    );
  });

  it('tribe://tribe/:tribeId resolves to (main)/campfire with tribeId', () => {
    fc.assert(
      fc.property(idArb, (tribeId) => {
        const url = `tribe://tribe/${tribeId}`;
        const resolved = resolveDeepLink(url);
        expect(resolved.path).toBe('/(main)/campfire');
        expect(resolved.params.tribeId).toBe(tribeId);
      }),
      { numRuns: 100 }
    );
  });

  it('tribe://share/:cardId resolves to (main)/campfire with share modal', () => {
    fc.assert(
      fc.property(idArb, (cardId) => {
        const url = `tribe://share/${cardId}`;
        const resolved = resolveDeepLink(url);
        expect(resolved.path).toBe('/(main)/campfire');
        expect(resolved.params.cardId).toBe(cardId);
        expect(resolved.showShareModal).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('invalid URLs resolve to home with error', () => {
    fc.assert(
      fc.property(fc.string(), (randomStr) => {
        // Skip strings that happen to be valid tribe:// URLs
        if (randomStr.startsWith('tribe://') && randomStr.split('/').filter(s => s.length > 0).length >= 3) return;

        const resolved = resolveDeepLink(randomStr);
        expect(resolved.path).toBe('/');
      }),
      { numRuns: 100 }
    );
  });
});

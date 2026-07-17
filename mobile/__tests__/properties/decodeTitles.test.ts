// Feature: tribe-mobile-app, Property 10: Title bitmask decoding correctness
import fc from 'fast-check';
import { Title, decodeTitles } from '../../types/match';

describe('Property 10: Title bitmask decoding correctness', () => {
  it('returns exactly the set of Title values whose bits are set in the bitmask', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 15 }), (bitmask) => {
        const result = decodeTitles(bitmask);
        const allTitles = [Title.Seer, Title.Chronicler, Title.Kindler, Title.Keeper];

        for (const title of allTitles) {
          const bitIsSet = (bitmask & title) !== 0;
          const isInResult = result.includes(title);
          expect(isInResult).toBe(bitIsSet);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('returns no values that are not Title enum members', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 15 }), (bitmask) => {
        const result = decodeTitles(bitmask);
        const validTitles = [Title.Seer, Title.Chronicler, Title.Kindler, Title.Keeper];
        for (const item of result) {
          expect(validTitles).toContain(item);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('returns empty array for bitmask 0', () => {
    expect(decodeTitles(0)).toEqual([]);
  });

  it('returns all titles for bitmask 15', () => {
    const result = decodeTitles(15);
    expect(result).toContain(Title.Seer);
    expect(result).toContain(Title.Chronicler);
    expect(result).toContain(Title.Kindler);
    expect(result).toContain(Title.Keeper);
    expect(result).toHaveLength(4);
  });
});

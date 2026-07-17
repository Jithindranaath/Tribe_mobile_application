/**
 * TRIBE Mobile App — Deep Link Resolution
 *
 * Parses incoming deep link URLs with the "tribe://" scheme and resolves
 * them to the appropriate in-app route and parameters.
 *
 * URI Pattern → Screen mapping:
 * - tribe://campfire/:fixtureId  → /(match)/[fixtureId]
 * - tribe://replay/:fixtureId   → /(match)/replay/[fixtureId]
 * - tribe://tribe/:tribeId      → /(main)/campfire with tribeId context
 * - tribe://share/:cardId       → /(main)/campfire with share modal
 *
 * Invalid deep links resolve to the home route.
 *
 * Exported for testability (Property 8).
 * Requirements: 8.4
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type DeepLinkRoute =
  | { type: 'campfire'; fixtureId: string }
  | { type: 'replay'; fixtureId: string }
  | { type: 'tribe'; tribeId: string }
  | { type: 'share'; cardId: string }
  | { type: 'home'; reason: string };

export interface ResolvedRoute {
  /** The expo-router path to navigate to */
  path: string;
  /** Route parameters to pass */
  params: Record<string, string>;
  /** Whether a share modal should be shown after navigation */
  showShareModal: boolean;
  /** Human-readable reason if navigation failed */
  errorReason?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SCHEME = 'tribe';
const VALID_PREFIXES = ['campfire', 'replay', 'tribe', 'share'] as const;
type ValidPrefix = (typeof VALID_PREFIXES)[number];

// ─── Resolution Logic ────────────────────────────────────────────────────────

/**
 * Parses a deep link URL and returns the resolved route type and parameters.
 *
 * @param url - The full deep link URL (e.g., "tribe://campfire/abc123")
 * @returns A DeepLinkRoute describing where to navigate
 */
export function parseDeepLink(url: string): DeepLinkRoute {
  if (!url || typeof url !== 'string') {
    return { type: 'home', reason: 'Empty or invalid URL' };
  }

  // Normalize: strip leading/trailing whitespace
  const trimmed = url.trim();

  // Validate scheme
  const schemePrefix = `${SCHEME}://`;
  if (!trimmed.startsWith(schemePrefix)) {
    return { type: 'home', reason: `Invalid scheme: expected "${SCHEME}://"` };
  }

  // Extract path after scheme
  const pathPart = trimmed.slice(schemePrefix.length);

  // Split path into segments, filtering empty strings (handles trailing slashes)
  const segments = pathPart.split('/').filter((s) => s.length > 0);

  if (segments.length < 2) {
    return { type: 'home', reason: 'Missing route prefix or parameter' };
  }

  const prefix = segments[0] as string;
  const param = segments[1] as string;

  // Validate the prefix is one of our known patterns
  if (!VALID_PREFIXES.includes(prefix as ValidPrefix)) {
    return { type: 'home', reason: `Unknown route: "${prefix}"` };
  }

  // Validate parameter is non-empty
  if (!param || param.trim().length === 0) {
    return { type: 'home', reason: 'Empty parameter value' };
  }

  switch (prefix) {
    case 'campfire':
      return { type: 'campfire', fixtureId: param };
    case 'replay':
      return { type: 'replay', fixtureId: param };
    case 'tribe':
      return { type: 'tribe', tribeId: param };
    case 'share':
      return { type: 'share', cardId: param };
    default:
      return { type: 'home', reason: `Unhandled prefix: "${prefix}"` };
  }
}

/**
 * Resolves a deep link URL to a navigable route path and parameters.
 * This is the primary export used by the app's deep link handler.
 *
 * @param url - The full deep link URL (e.g., "tribe://campfire/abc123")
 * @returns A ResolvedRoute with the target path, params, and modal flags
 */
export function resolveDeepLink(url: string): ResolvedRoute {
  const parsed = parseDeepLink(url);

  switch (parsed.type) {
    case 'campfire':
      return {
        path: '/(match)/[fixtureId]',
        params: { fixtureId: parsed.fixtureId },
        showShareModal: false,
      };

    case 'replay':
      return {
        path: '/(match)/replay/[fixtureId]',
        params: { fixtureId: parsed.fixtureId },
        showShareModal: false,
      };

    case 'tribe':
      return {
        path: '/(main)/campfire',
        params: { tribeId: parsed.tribeId },
        showShareModal: false,
      };

    case 'share':
      return {
        path: '/(main)/campfire',
        params: { cardId: parsed.cardId },
        showShareModal: true,
      };

    case 'home':
    default:
      return {
        path: '/',
        params: {},
        showShareModal: false,
        errorReason: parsed.reason,
      };
  }
}

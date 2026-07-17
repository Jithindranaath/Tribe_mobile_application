/**
 * Share Card Generation Service — renders shareable images from notable Moments.
 *
 * Uses satori (SVG rendering) + @resvg/resvg-js (SVG → PNG rasterization)
 * to produce 1080×1920 Instagram-story-sized share cards server-side.
 *
 * Template: dark background with tribe accent colors, fan's call text,
 * outcome checkmark/cross, timing badge, tribe badge, and TRIBE branding.
 *
 * Requirements: 15.1, 15.2, 15.6
 */

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { getSupabaseClient } from '../lib/supabase.js';
import type { ShareCardsInsert } from '../db/schema.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShareCardMomentData {
  fanId: string;
  fixtureId: number;
  callText: string;
  outcome: 'correct' | 'incorrect';
  timing: string; // e.g. "40s early"
  difficulty: number; // difficulty_multiplier
  standingDelta: number;
  tribeName: string;
}

export interface ShareCardResult {
  cardId: string;
  imageUrl: string;
  pngBuffer: Buffer;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;

// Inter font fallback — in production you'd load a real font file.
// For the hackathon, we embed a minimal font weight placeholder.
// Satori requires at least one font to render text.
const FONT_FALLBACK_URL =
  'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-700-normal.woff';

let cachedFont: ArrayBuffer | null = null;

/**
 * Loads the Inter Bold font for satori rendering.
 * Caches in memory after first load.
 */
async function loadFont(): Promise<ArrayBuffer> {
  if (cachedFont) return cachedFont;

  const response = await fetch(FONT_FALLBACK_URL);
  cachedFont = await response.arrayBuffer();
  return cachedFont;
}

// ─── Template ────────────────────────────────────────────────────────────────

/**
 * Builds the JSX-like element tree for satori to render.
 * Fixed template: dark bg, tribe accent, call text, outcome, timing, branding.
 */
function buildShareCardMarkup(data: ShareCardMomentData) {
  const isCorrect = data.outcome === 'correct';
  const accentColor = isCorrect ? '#10B981' : '#EF4444'; // green or red
  const outcomeIcon = isCorrect ? '✓' : '✗';
  const outcomeLabel = isCorrect ? 'CALLED IT' : 'MISSED';
  const deltaText = data.standingDelta >= 0
    ? `+${data.standingDelta} Standing`
    : `${data.standingDelta} Standing`;

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: 'linear-gradient(180deg, #0F0F1A 0%, #1A1A2E 50%, #0F0F1A 100%)',
        padding: '80px 60px',
        fontFamily: 'Inter',
        color: '#FFFFFF',
      },
      children: [
        // TRIBE branding at top
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '80px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '42px',
                    fontWeight: 700,
                    letterSpacing: '8px',
                    color: '#A78BFA',
                  },
                  children: 'TRIBE',
                },
              },
            ],
          },
        },
        // Tribe badge
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px 40px',
              borderRadius: '40px',
              border: '2px solid #A78BFA',
              marginBottom: '60px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '32px',
                    fontWeight: 700,
                    color: '#A78BFA',
                  },
                  children: data.tribeName,
                },
              },
            ],
          },
        },
        // Outcome icon (large)
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '180px',
              height: '180px',
              borderRadius: '90px',
              backgroundColor: accentColor,
              marginBottom: '50px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '96px',
                    fontWeight: 700,
                    color: '#FFFFFF',
                  },
                  children: outcomeIcon,
                },
              },
            ],
          },
        },
        // Outcome label
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              fontSize: '56px',
              fontWeight: 700,
              color: accentColor,
              marginBottom: '40px',
              letterSpacing: '4px',
            },
            children: outcomeLabel,
          },
        },
        // Call text
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              fontSize: '44px',
              fontWeight: 700,
              color: '#E2E8F0',
              textAlign: 'center',
              marginBottom: '40px',
              maxWidth: '900px',
            },
            children: `"${data.callText}"`,
          },
        },
        // Timing badge
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '14px 36px',
              borderRadius: '30px',
              backgroundColor: '#1E293B',
              border: '1px solid #475569',
              marginBottom: '40px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '28px',
                    fontWeight: 700,
                    color: '#94A3B8',
                  },
                  children: `⏱ ${data.timing}`,
                },
              },
            ],
          },
        },
        // Standing delta
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              fontSize: '36px',
              fontWeight: 700,
              color: isCorrect ? '#10B981' : '#EF4444',
              marginBottom: '80px',
            },
            children: deltaText,
          },
        },
        // Footer branding
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'absolute',
              bottom: '80px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: '24px',
                    fontWeight: 700,
                    color: '#64748B',
                    letterSpacing: '2px',
                  },
                  children: 'tribe.gg',
                },
              },
            ],
          },
        },
      ],
    },
  };
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Generates a share card PNG from moment data.
 *
 * 1. Builds the markup template
 * 2. Renders to SVG via satori
 * 3. Rasterizes SVG → PNG via @resvg/resvg-js
 *
 * @param momentData The moment payload for card rendering
 * @returns PNG buffer (1080×1920)
 */
export async function generateShareCard(
  momentData: ShareCardMomentData
): Promise<Buffer> {
  const fontData = await loadFont();

  const markup = buildShareCardMarkup(momentData);

  // Render to SVG with satori
  const svg = await satori(markup as any, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: [
      {
        name: 'Inter',
        data: fontData,
        weight: 700,
        style: 'normal',
      },
    ],
  });

  // Rasterize SVG → PNG with resvg
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: CARD_WIDTH,
    },
  });

  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  return Buffer.from(pngBuffer);
}

/**
 * Stores a rendered share card.
 *
 * For the hackathon: stores the PNG in Supabase Storage (bucket: "share-cards")
 * and records the public URL in the share_cards table.
 *
 * Falls back to a base64 data URL if storage upload fails.
 *
 * @param fanId The fan who owns this share card
 * @param fixtureId The fixture the moment occurred in
 * @param imageBuffer The rendered PNG buffer
 * @returns The stored card_id and image URL
 */
export async function storeShareCard(
  fanId: string,
  fixtureId: number,
  imageBuffer: Buffer
): Promise<ShareCardResult> {
  const supabase = getSupabaseClient();
  const cardId = crypto.randomUUID();
  const filePath = `cards/${fanId}/${cardId}.png`;

  // Attempt Supabase Storage upload
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('share-cards')
    .upload(filePath, imageBuffer, {
      contentType: 'image/png',
      upsert: false,
    });

  let imageUrl: string;

  if (uploadError) {
    // Fallback: base64 data URL (works for demo / local dev)
    console.warn(
      '[ShareCards] Storage upload failed, using data URL fallback:',
      uploadError.message
    );
    imageUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;
  } else {
    // Get public URL from Supabase Storage
    const { data: urlData } = supabase.storage
      .from('share-cards')
      .getPublicUrl(filePath);
    imageUrl = urlData.publicUrl;
  }

  // Insert record into share_cards table
  const insertData: ShareCardsInsert = {
    fan_id: fanId,
    fixture_id: fixtureId,
    template: 'read_success',
    image_url: imageUrl,
  };

  const { error: insertError } = await supabase
    .from('share_cards')
    .insert(insertData);

  if (insertError) {
    console.error('[ShareCards] DB insert error:', insertError.message);
  }

  return {
    cardId,
    imageUrl,
    pngBuffer: imageBuffer,
  };
}

/**
 * Convenience function: generates and stores a share card in one call.
 *
 * @param momentData The moment payload
 * @returns The stored card result with cardId, imageUrl, and pngBuffer
 */
export async function createShareCard(
  momentData: ShareCardMomentData
): Promise<ShareCardResult> {
  const pngBuffer = await generateShareCard(momentData);
  return storeShareCard(momentData.fanId, momentData.fixtureId, pngBuffer);
}

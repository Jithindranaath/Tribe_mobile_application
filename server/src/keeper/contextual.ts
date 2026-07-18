/**
 * Contextual AI Read Prompts using Anthropic Claude.
 *
 * Generates punchy, contextual prediction questions based on live match events.
 * Falls back to template-based questions when the API key is missing or calls fail.
 */

import { getEnvConfig } from '../config/env.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MatchContext {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  eventType: string; // 'goal' | 'red_card' | 'odds_shift'
  eventDetail?: string;
}

// ─── Template Fallbacks ──────────────────────────────────────────────────────

const TEMPLATE_FALLBACKS: Record<string, string[]> = {
  goal: [
    'Another goal in the next 10 minutes?',
    'Will the lead hold?',
    'Goal before half-time?',
    'Will they equalize in the next 5 minutes?',
  ],
  red_card: [
    'Will the 10-man team concede next?',
    'Red card changes everything — next goal within 10?',
    'Does the red card lead to a goal?',
  ],
  odds_shift: [
    'The market shifted — goal incoming?',
    'Momentum is changing — next scorer?',
    'Big swing in the odds — will they score?',
  ],
  default: [
    'Goal in the next 5 minutes?',
    'Will there be a card next?',
    'Next goal before 75 minutes?',
  ],
};

// ─── Main Function ───────────────────────────────────────────────────────────

/**
 * Generates a contextual Read prompt question using Claude.
 * Falls back to templates if no API key or if the call fails.
 */
export async function generateContextualReadPrompt(context: MatchContext): Promise<string> {
  const { anthropicApiKey } = getEnvConfig();

  if (!anthropicApiKey) {
    return pickTemplate(context.eventType);
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 60,
        messages: [
          {
            role: 'user',
            content: `You are the Keeper — an AI that surfaces one prediction question at tense moments during a live football match. The match is ${context.homeTeam} ${context.homeScore}-${context.awayScore} ${context.awayTeam}, minute ${context.minute}. A ${context.eventType} just happened${context.eventDetail ? ': ' + context.eventDetail : ''}. Generate ONE short, punchy yes/no prediction question that fans can answer. Just the question, nothing else. Example: "Goal before half-time?" or "Will they equalize in the next 5 minutes?"`,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = (await response.json()) as { content?: Array<{ text?: string }> };
    const text = data.content?.[0]?.text?.trim();

    if (text && text.length > 5 && text.length < 100) {
      return text;
    }
    throw new Error('Invalid response format');
  } catch (error) {
    console.warn(
      '[Keeper/Contextual] AI prompt generation failed, using template:',
      error instanceof Error ? error.message : String(error)
    );
    return pickTemplate(context.eventType);
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function pickTemplate(eventType: string): string {
  const templates = TEMPLATE_FALLBACKS[eventType] || TEMPLATE_FALLBACKS.default;
  return templates[Math.floor(Math.random() * templates.length)];
}

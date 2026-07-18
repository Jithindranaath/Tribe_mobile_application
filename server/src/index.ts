import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { campfireWS } from './ws/server.js';
import readsRouter from './routes/reads.js';
import { TxLINEAuth } from './txline/auth.js';
import { TxLINEActivation } from './txline/activation.js';
import { TxLINEStreamManager } from './txline/streams.js';
import { JWTRefreshLoop } from './txline/refresh-loop.js';
import { eventBus, GOAL_EVENT, RED_CARD_EVENT, STATE_CHANGE_EVENT, ODDS_SHIFT_EVENT } from './events/event-bus.js';
import { KeeperEvaluator } from './keeper/evaluator.js';
import { KeeperInjectService } from './keeper/injects.js';
import { generateContextualReadPrompt, MatchContext } from './keeper/contextual.js';
import type { ReadPromptPayload } from './ws/types.js';
import type { GoalEvent, RedCardEvent, StateChangeEvent, OddsShiftEvent } from './events/event-bus.js';

config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─── In-Memory Match State ─────────────────────────────────────────────────

interface MatchState {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  minute: number;
  gameState: string;
}

const matchStates = new Map<string, MatchState>();

/**
 * Get or initialize a match state for a fixture.
 * Default team names are placeholders until configured via the live fixture data.
 */
function getMatchState(fixtureId: string): MatchState {
  if (!matchStates.has(fixtureId)) {
    matchStates.set(fixtureId, {
      homeTeam: 'Home',
      awayTeam: 'Away',
      homeScore: 0,
      awayScore: 0,
      minute: 0,
      gameState: '1H',
    });
  }
  return matchStates.get(fixtureId)!;
}

// ─── Tribe ID Resolver ─────────────────────────────────────────────────────
// For now: returns all tribes watching this fixture based on active WS rooms.

function tribeIdResolver(fixtureId: string): string[] {
  const rooms = campfireWS.getActiveRooms();
  return rooms
    .filter((r) => r.fixtureId === fixtureId)
    .map((r) => r.tribeId);
}

// ─── Health check ──────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'tribe-server', timestamp: Date.now() });
});

// ─── Routes ────────────────────────────────────────────────────────────────

app.use('/api/reads', readsRouter);

// Demo broadcast endpoint (dev only — allows simulation script to push events)
app.post('/api/demo/broadcast', (req, res) => {
  const { tribeId, fixtureId, event } = req.body;
  if (!tribeId || !fixtureId || !event) {
    return res.status(400).json({ error: 'Missing tribeId, fixtureId, or event' });
  }
  campfireWS.broadcastToTribe(tribeId, fixtureId, event);
  return res.json({ success: true, recipients: campfireWS.getPresenceCount(tribeId, fixtureId) });
});

// ─── Match state update endpoint (set team names for a fixture) ────────────

app.post('/api/match/configure', (req, res) => {
  const { fixtureId, homeTeam, awayTeam } = req.body;
  if (!fixtureId) {
    return res.status(400).json({ error: 'Missing fixtureId' });
  }
  const state = getMatchState(fixtureId);
  if (homeTeam) state.homeTeam = homeTeam;
  if (awayTeam) state.awayTeam = awayTeam;
  return res.json({ success: true, state });
});

// ─── Create HTTP server and attach WebSocket ───────────────────────────────

const httpServer = createServer(app);
campfireWS.attach(httpServer);

// ─── TxLINE Pipeline Startup ───────────────────────────────────────────────

async function startTxLINEPipeline(): Promise<void> {
  console.log('[TRIBE] Initializing TxLINE live data pipeline...');

  // 1. Create TxLINEAuth → acquire guest JWT
  const auth = new TxLINEAuth();
  let jwtAcquired = false;

  try {
    await auth.acquireGuestJWT();
    jwtAcquired = true;
    console.log('[TRIBE] ✓ Guest JWT acquired');
  } catch (err) {
    console.warn('[TRIBE] ⚠ JWT acquisition failed:', err instanceof Error ? err.message : String(err));
    console.warn('[TRIBE] Will try with API token only...');
  }

  // 2. Create TxLINEActivation — load token from env (skip on-chain activation)
  const activation = new TxLINEActivation(auth);
  const loadedFromEnv = activation.loadFromEnv();

  if (!loadedFromEnv) {
    console.warn('[TRIBE] ✗ No TXLINE_API_TOKEN in environment — cannot connect streams');
    console.warn('[TRIBE] Set TXLINE_API_TOKEN in .env to enable live data');
    return;
  }
  console.log('[TRIBE] ✓ API token loaded from environment');

  // 3. Start JWT refresh loop only if JWT was acquired
  if (jwtAcquired) {
    const refreshLoop = new JWTRefreshLoop(auth, {
      onRefresh: () => console.log('[TRIBE] JWT refreshed successfully'),
    });
    refreshLoop.on('refresh_failed', ({ attempts, lastError }) => {
      console.error(`[TRIBE] ✗ JWT refresh failed after ${attempts} attempts: ${lastError}`);
    });
    refreshLoop.start();
    console.log('[TRIBE] ✓ JWT refresh loop started');
  }

  // 4. Create TxLINEStreamManager → connect both streams
  const streamManager = new TxLINEStreamManager(activation);

  streamManager.on('stream_failed', ({ streamType, attempts }) => {
    console.warn(`[TRIBE] ⚠ ${streamType} stream failed after ${attempts} reconnect attempts — replay mode would kick in`);
  });

  try {
    await streamManager.connectScoresStream();
    console.log('[TRIBE] ✓ Scores stream connected');
  } catch (err) {
    console.error('[TRIBE] ✗ Scores stream connection failed:', err instanceof Error ? err.message : String(err));
  }

  try {
    await streamManager.connectOddsStream();
    console.log('[TRIBE] ✓ Odds stream connected');
  } catch (err) {
    console.error('[TRIBE] ✗ Odds stream connection failed:', err instanceof Error ? err.message : String(err));
  }

  // 5. Create KeeperEvaluator → start (subscribes to event bus)
  const evaluator = new KeeperEvaluator(eventBus);
  evaluator.start();
  console.log('[TRIBE] ✓ Keeper evaluator started');

  // 6. Create KeeperInjectService → hook into evaluator
  const injectService = new KeeperInjectService(evaluator, campfireWS, tribeIdResolver);
  console.log('[TRIBE] ✓ Keeper inject service started');

  // 7. Wire event bus listeners for match state updates + broadcasts

  // ── GOAL_EVENT: update match state, broadcast match header + contextual read prompt
  eventBus.on(GOAL_EVENT, async (event: GoalEvent) => {
    const state = getMatchState(event.fixtureId);

    // Update scores
    if (event.team === 'home') {
      state.homeScore++;
    } else {
      state.awayScore++;
    }
    state.gameState = event.gameState;

    // Estimate minute from game state (rough — TxLINE doesn't always send minute)
    const minuteEstimate = estimateMinute(event.gameState, event.timestamp);
    state.minute = minuteEstimate;

    console.log(`[TRIBE] ⚽ GOAL: ${state.homeTeam} ${state.homeScore}-${state.awayScore} ${state.awayTeam} (${event.team}, min ${minuteEstimate})`);

    // Broadcast match header update to all tribes watching this fixture
    broadcastMatchHeader(event.fixtureId, state);

    // Generate contextual read prompt if evaluator decided read_prompt
    // (The evaluator's onDecision handles inject via KeeperInjectService,
    //  but for read_prompt we handle it here with AI generation)
  });

  // ── RED_CARD_EVENT: update state and log
  eventBus.on(RED_CARD_EVENT, (event: RedCardEvent) => {
    const state = getMatchState(event.fixtureId);
    state.gameState = event.gameState;
    console.log(`[TRIBE] 🟥 RED CARD: ${state.homeTeam} vs ${state.awayTeam} (${event.player || 'unknown player'})`);
  });

  // ── STATE_CHANGE_EVENT: update game state
  eventBus.on(STATE_CHANGE_EVENT, (event: StateChangeEvent) => {
    const state = getMatchState(event.fixtureId);
    state.gameState = event.newGameState;
    console.log(`[TRIBE] 📋 State change: ${event.newGameState} — ${state.homeTeam} vs ${state.awayTeam}`);

    // Broadcast updated header
    broadcastMatchHeader(event.fixtureId, state);
  });

  // ── ODDS_SHIFT_EVENT: log and let evaluator handle
  eventBus.on(ODDS_SHIFT_EVENT, (event: OddsShiftEvent) => {
    const state = getMatchState(event.fixtureId);
    console.log(`[TRIBE] 📊 Odds shift: ${event.market} ${(event.percentChange * 100).toFixed(1)}% — ${state.homeTeam} vs ${state.awayTeam}`);

    // If magnitude > 20%, also trigger an inject
    if (Math.abs(event.percentChange) > 0.20) {
      injectService.injectForOddsShift(event.fixtureId, event.percentChange * 100);
    }
  });

  // 8. Wire Keeper read_prompt decisions to contextual AI prompts
  const originalOnDecision = evaluator['onDecision'];
  evaluator.setOnDecision(async (decision) => {
    // Let the inject service handle inject decisions (it was set first, so we call it)
    injectService.handleDecision(decision);

    // Handle read_prompt decisions with contextual AI
    if (decision.action === 'read_prompt') {
      const state = getMatchState(decision.fixtureId);

      // Determine event type for context
      let eventType = 'default';
      if (decision.eventType === GOAL_EVENT) eventType = 'goal';
      else if (decision.eventType === RED_CARD_EVENT) eventType = 'red_card';
      else if (decision.eventType === ODDS_SHIFT_EVENT) eventType = 'odds_shift';

      const context: MatchContext = {
        homeTeam: state.homeTeam,
        awayTeam: state.awayTeam,
        homeScore: state.homeScore,
        awayScore: state.awayScore,
        minute: state.minute,
        eventType,
      };

      // Generate contextual question (async, but don't block)
      try {
        const question = await generateContextualReadPrompt(context);

        const readPrompt: ReadPromptPayload = {
          readId: randomUUID(),
          readType: 'moment_read',
          question,
          options: ['Yes', 'No'],
          difficultyMultiplier: 1.0,
          expiresAt: Date.now() + 60_000, // 60 seconds to answer
        };

        // Broadcast to all tribes watching this fixture
        const tribeIds = tribeIdResolver(decision.fixtureId);
        for (const tribeId of tribeIds) {
          campfireWS.broadcastReadPrompt(tribeId, decision.fixtureId, readPrompt);
        }

        console.log(`[TRIBE] 📖 Read prompt surfaced: "${question}" → ${tribeIds.length} tribe(s)`);
      } catch (err) {
        console.error('[TRIBE] Failed to generate/broadcast read prompt:', err instanceof Error ? err.message : String(err));
      }
    }
  });

  console.log('[TRIBE] ✓ TxLINE pipeline fully wired — live data flowing');
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Broadcast a match header update to all connected tribes for a fixture.
 * The mobile app's useCampfireSocket handles 'conviction' type events with match data.
 */
function broadcastMatchHeader(fixtureId: string, state: MatchState): void {
  const tribeIds = tribeIdResolver(fixtureId);
  const presenceCount = tribeIds.reduce((sum, tribeId) => {
    return sum + campfireWS.getPresenceCount(tribeId, fixtureId);
  }, 0);

  for (const tribeId of tribeIds) {
    campfireWS.broadcastToTribe(tribeId, fixtureId, {
      type: 'conviction',
      payload: {
        readId: `match_header_${fixtureId}`,
        signal: Math.min(presenceCount / 100, 1.0), // Normalize presence to 0-1 signal
        participantCount: presenceCount,
      },
      timestamp: Date.now(),
    });
  }
}

/**
 * Rough minute estimate based on game state and timestamp.
 * TxLINE doesn't always send an explicit minute field.
 */
function estimateMinute(gameState: string, _timestamp: number): number {
  switch (gameState) {
    case '1H': return 25; // Rough midpoint of first half
    case 'HT': return 45;
    case '2H': return 65; // Rough midpoint of second half
    case 'FT': return 90;
    case 'ET': return 105;
    case 'AET': return 120;
    default: return 45;
  }
}

// ─── Server Start ──────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[TRIBE] Server running on port ${PORT}`);

  // Start TxLINE pipeline asynchronously (don't block server startup)
  startTxLINEPipeline().catch((err) => {
    console.error('[TRIBE] TxLINE pipeline startup failed:', err instanceof Error ? err.message : String(err));
    console.warn('[TRIBE] Server continues without live data — use /api/demo/broadcast for testing');
  });
});

export { app, httpServer };

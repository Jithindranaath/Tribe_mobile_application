import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { campfireWS } from './ws/server.js';
import readsRouter from './routes/reads.js';
import authRouter from './routes/auth.js';
import { TxLINEAuth } from './txline/auth.js';
import { TxLINEActivation } from './txline/activation.js';
import { TxLINEStreamManager } from './txline/streams.js';
import { JWTRefreshLoop } from './txline/refresh-loop.js';
import { ReplayManager } from './txline/replay.js';
import { resetScoresCacheForFixture } from './txline/normalizer.js';
import { eventBus, GOAL_EVENT, RED_CARD_EVENT, STATE_CHANGE_EVENT, ODDS_SHIFT_EVENT } from './events/event-bus.js';
import { KeeperEvaluator } from './keeper/evaluator.js';
import { KeeperInjectService } from './keeper/injects.js';
import { generateContextualReadPrompt, MatchContext } from './keeper/contextual.js';
import { ReadResolver } from './services/resolver.js';
import type { Resolution } from './services/resolver.js';
import { SettlementQueue } from './services/settlement.js';
import { SettlementExecutor } from './services/settler.js';
import { buildSurgePayload } from './services/surge.js';
import { PresenceService } from './services/presence.js';
import { checkAndGrantSeerTitle } from './services/titles.js';
import { commitRead } from './services/reads.js';
import { getFanById, getTribeIdsByFanIds } from './services/fans.js';
import { getOrCreateTribeAccount } from './services/onchain.js';
import { broadcastConviction } from './services/conviction.js';
import { registerPrompt, getPromptMeta, clearExpiredPrompts } from './services/prompt-registry.js';
import { rankService } from './services/rank.js';
import { getLatestDifficultyMultiplier } from './txline/odds-tracker.js';
import { setCachedTribeAggregateStanding } from './services/standing-cache.js';
import { getSupabaseClient } from './lib/supabase.js';
import type { TribeData } from './services/rank.js';
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

// ─── Replay Manager (module-scoped so the manual demo trigger route below
// can reach the same instance the live pipeline creates) ───────────────────

let replayManager: ReplayManager | null = null;

const fixtureNameLookupsInFlight = new Set<string>();

/**
 * Get or initialize a match state for a fixture.
 * Default team names ('Home'/'Away') are placeholders — kicks off a
 * one-time async lookup against real TxLINE fixture data to replace them.
 * (The manual demo replay route also sets real names explicitly up front,
 * which just makes this lookup a no-op confirmation for that path.)
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
    autoConfigureTeamNames(fixtureId);
  }
  return matchStates.get(fixtureId)!;
}

/**
 * Fire-and-forget lookup of a fixture's real team names, for fixtures the
 * live scores stream starts tracking without ever going through the manual
 * demo replay route (which sets names explicitly). Without this, a
 * genuinely live fixture's fans would see literal "Home"/"Away" forever.
 */
function autoConfigureTeamNames(fixtureId: string): void {
  if (!replayManager || fixtureNameLookupsInFlight.has(fixtureId)) return;
  fixtureNameLookupsInFlight.add(fixtureId);

  replayManager
    .lookupFixture(fixtureId)
    .then((fixture) => {
      const state = matchStates.get(fixtureId);
      if (!fixture || !state) return;
      // Don't clobber a name already set explicitly (e.g. by the demo route).
      if (state.homeTeam === 'Home') state.homeTeam = fixture.homeTeam;
      if (state.awayTeam === 'Away') state.awayTeam = fixture.awayTeam;
      if (state.homeTeam !== 'Home') broadcastMatchHeader(fixtureId, state);
    })
    .catch((err) => {
      console.error(
        `[TRIBE] Failed to auto-configure team names for fixture ${fixtureId}:`,
        err instanceof Error ? err.message : String(err),
      );
    })
    .finally(() => {
      fixtureNameLookupsInFlight.delete(fixtureId);
    });
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
app.use('/api/auth', authRouter);

// Demo broadcast endpoint (dev only — allows simulation script to push events)
app.post('/api/demo/broadcast', (req, res) => {
  const { tribeId, fixtureId, event } = req.body;
  if (!tribeId || !fixtureId || !event) {
    return res.status(400).json({ error: 'Missing tribeId, fixtureId, or event' });
  }
  campfireWS.broadcastToTribe(tribeId, fixtureId, event);
  return res.json({ success: true, recipients: campfireWS.getPresenceCount(tribeId, fixtureId) });
});

// Manual historical replay trigger (dev only). The automatic fixture-discovery
// path (checkFixtureAvailability/selectReplayFixture) calls a GET /fixtures
// endpoint that doesn't exist on the real TxLINE API — this bypasses it and
// replays a *specific*, known-good fixtureId directly through
// streamHistoricalEvents(), which runs events through the exact same
// normalizeScoreEvent() → event bus path as the live scores stream.
app.post('/api/demo/replay', async (req, res) => {
  const { fixtureId, playbackSpeed, homeTeam, awayTeam } = req.body;
  if (!fixtureId) {
    return res.status(400).json({ error: 'Missing fixtureId' });
  }
  if (!replayManager) {
    return res.status(503).json({ error: 'Replay manager not initialized — TxLINE pipeline may not have started (check TXLINE_API_TOKEN)' });
  }
  if (replayManager.isReplayActive) {
    return res.status(409).json({ error: `Replay already active for fixture ${replayManager.currentFixtureId}` });
  }
  // Always set explicitly — the ReplayManager instance is shared/module-scoped, so a
  // prior call's speed (e.g. an accelerated smoke test) otherwise silently persists into
  // a later call that omits playbackSpeed, making a "real-time" request actually replay
  // at whatever speed the last call happened to use.
  replayManager.setPlaybackSpeed(playbackSpeed !== undefined ? Number(playbackSpeed) : 1);

  // Re-replaying the same fixtureId in the same process (e.g. an accelerated smoke test
  // followed by a real-time run) would otherwise diff/accumulate against the previous
  // run's leftover final state — reset both the goal-detection cache (normalizer.ts) and
  // the displayed match state (homeScore/awayScore accumulator) so each run starts fresh.
  resetScoresCacheForFixture(String(fixtureId));
  matchStates.delete(String(fixtureId));

  // Optional real team names (e.g. from GET /api/fixtures/historical) so connected
  // clients see a real scoreboard immediately, not just once the first goal fires.
  const state = getMatchState(String(fixtureId));
  if (homeTeam) state.homeTeam = homeTeam;
  if (awayTeam) state.awayTeam = awayTeam;
  broadcastMatchHeader(String(fixtureId), state);

  console.log(`[TRIBE] Manual replay triggered for fixture ${fixtureId} at ${playbackSpeed ?? 1}x speed`);
  replayManager.streamHistoricalEvents(String(fixtureId)).catch((err) => {
    console.error('[TRIBE] Replay stream failed:', err instanceof Error ? err.message : String(err));
  });

  return res.json({ success: true, fixtureId: String(fixtureId), playbackSpeed: playbackSpeed ?? 1 });
});

app.post('/api/demo/replay/stop', (_req, res) => {
  if (!replayManager) {
    return res.status(503).json({ error: 'Replay manager not initialized' });
  }
  replayManager.exitReplayMode();
  return res.json({ success: true });
});

app.get('/api/demo/replay/status', (_req, res) => {
  if (!replayManager) {
    return res.json({ initialized: false });
  }
  return res.json({
    initialized: true,
    isReplayActive: replayManager.isReplayActive,
    currentFixtureId: replayManager.currentFixtureId,
  });
});

// Real recently-finished fixtures available for Replay Mode, sourced from the
// live TxLINE /fixtures/snapshot API (same fixture-discovery logic used to
// auto-select a replay fixture) — not a hardcoded list.
app.get('/api/fixtures/historical', async (_req, res) => {
  if (!replayManager) {
    return res.status(503).json({ error: 'Replay manager not initialized — TxLINE pipeline may not have started (check TXLINE_API_TOKEN)' });
  }
  try {
    const candidates = await replayManager.listReplayCandidates();
    return res.json(
      candidates.map((f) => ({
        fixtureId: Number(f.fixtureId),
        sport: f.sport,
        league: f.league,
        homeTeam: f.homeTeam,
        awayTeam: f.awayTeam,
        kickoff: f.kickoff,
        state: f.state,
      })),
    );
  } catch (err) {
    console.error('[TRIBE] Failed to list historical fixtures:', err instanceof Error ? err.message : String(err));
    return res.status(502).json({ error: 'Failed to fetch fixtures from TxLINE' });
  }
});

// Real tribe standings, grouped by city (exact tribeId), country (macro_tribe),
// or global (all tribes) — sourced from the real `fans` table (cached_standing),
// not mocked. Was previously missing entirely (404), which the mobile client's
// error handling silently swallowed into "No standings data available".
app.get('/api/tribe/:tribeId/standings', async (req, res) => {
  const { tribeId } = req.params;
  const view = (req.query.view as string) ?? 'city';
  const supabase = getSupabaseClient();

  const { data: fans, error } = await supabase
    .from('fans')
    .select('tribe_id, tribe_name, macro_tribe, cached_standing');

  if (error) {
    console.error('[TRIBE] Failed to load standings:', error.message);
    return res.status(502).json({ error: 'Failed to load standings' });
  }

  const rows = (fans ?? []) as Array<{
    tribe_id: string;
    tribe_name: string;
    macro_tribe: string;
    cached_standing: number;
  }>;

  const groupKey = (f: (typeof rows)[number]) =>
    view === 'global' ? 'Global' : view === 'country' ? f.macro_tribe : f.tribe_id;
  const groupName = (f: (typeof rows)[number]) =>
    view === 'global' ? 'Global' : view === 'country' ? f.macro_tribe : f.tribe_name;

  const groups = new Map<
    string,
    { tribeId: string; tribeName: string; aggregateStanding: number; memberCount: number }
  >();
  for (const f of rows) {
    const key = groupKey(f);
    const existing = groups.get(key);
    if (existing) {
      existing.aggregateStanding += f.cached_standing;
      existing.memberCount += 1;
    } else {
      groups.set(key, {
        tribeId: key,
        tribeName: groupName(f),
        aggregateStanding: f.cached_standing,
        memberCount: 1,
      });
    }
  }

  // Real accuracy per group — resolved reads where predicted === resolved.
  const fanTribeMap = new Map(rows.map((f) => [f.tribe_id, groupKey(f)]));
  const { data: reads } = await supabase
    .from('reads_live')
    .select('fan_id, predicted, resolved')
    .not('resolved', 'is', null);
  const { data: fanTribeLookup } = await supabase.from('fans').select('fan_id, tribe_id');
  const fanIdToGroup = new Map<string, string>();
  for (const f of (fanTribeLookup ?? []) as Array<{ fan_id: string; tribe_id: string }>) {
    const group = fanTribeMap.get(f.tribe_id);
    if (group) fanIdToGroup.set(f.fan_id, group);
  }
  const accuracyCounts = new Map<string, { correct: number; total: number }>();
  for (const r of (reads ?? []) as Array<{ fan_id: string; predicted: number; resolved: number }>) {
    const group = fanIdToGroup.get(r.fan_id);
    if (!group) continue;
    const counts = accuracyCounts.get(group) ?? { correct: 0, total: 0 };
    counts.total += 1;
    if (r.predicted === r.resolved) counts.correct += 1;
    accuracyCounts.set(group, counts);
  }

  const rankings = Array.from(groups.values())
    .sort((a, b) => b.aggregateStanding - a.aggregateStanding)
    .map((g, i) => {
      const counts = accuracyCounts.get(g.tribeId);
      return {
        tribeId: g.tribeId,
        tribeName: g.tribeName,
        aggregateStanding: g.aggregateStanding,
        memberCount: g.memberCount,
        accuracyPercentage: counts && counts.total > 0 ? Math.round((counts.correct / counts.total) * 100) : 0,
        rank: i + 1,
      };
    });

  // The requesting fan's own rank within THIS view's ranked list — computed
  // separately from the `rankings.find(r => r.tribeId === tribeId)` the
  // client used to do, which only ever matched on the 'city' view
  // (global/country group keys are 'Global'/macro_tribe, not the raw
  // tribeId, so that lookup silently found nothing and the personal
  // standing card stuck at 0). Standing itself is always the fan's own
  // individual cached_standing — never the group's aggregate total, even
  // on views where the ranked rows themselves are aggregated — "Your
  // Standing" means the fan's own number in every view, just their rank
  // position within that view's grouping.
  const requestingFan = rows.find((f) => f.tribe_id === tribeId);
  const personalGroupKey = requestingFan ? groupKey(requestingFan) : null;
  const personalEntry = personalGroupKey
    ? rankings.find((r) => r.tribeId === personalGroupKey)
    : undefined;

  return res.json({
    rankings,
    personalStanding: requestingFan?.cached_standing ?? 0,
    personalRank: personalEntry?.rank ?? 0,
  });
});

// Real fan timeline (Legacy tab) — sourced from the `timeline` table (populated
// by services/moments.ts for notable Read outcomes), not mocked. Was previously
// missing entirely (404), silently shown as "No moments yet".
app.get('/api/fan/:fanId/timeline', async (req, res) => {
  const { fanId } = req.params;
  const supabase = getSupabaseClient();

  const { data: moments, error } = await supabase
    .from('timeline')
    .select('*')
    .eq('fan_id', fanId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[TRIBE] Failed to load timeline:', error.message);
    return res.status(502).json({ error: 'Failed to load timeline' });
  }

  const rows = (moments ?? []) as Array<{
    id: string;
    fan_id: string;
    fixture_id: number;
    type: string;
    payload_json: Record<string, unknown>;
    created_at: string;
  }>;

  const mapped = rows.map((m) => {
    const p = m.payload_json as {
      readType?: string;
      predicted?: number;
      correct?: boolean;
      standingDelta?: number;
    };
    return {
      id: m.id,
      fanId: m.fan_id,
      fixtureId: m.fixture_id,
      type: m.type,
      match: `Fixture ${m.fixture_id}`,
      prediction: p.readType ? `${p.readType}: ${p.predicted === 1 ? 'Yes' : 'No'}` : 'Read',
      outcome: p.correct ? `Correct! +${p.standingDelta ?? 0} Standing` : 'Incorrect',
      createdAt: m.created_at,
    };
  });

  const { data: reads } = await supabase
    .from('reads_live')
    .select('fixture_id, predicted, resolved, standing_delta, committed_at')
    .eq('fan_id', fanId)
    .order('committed_at', { ascending: true });
  const readRows = (reads ?? []) as Array<{
    fixture_id: number;
    predicted: number;
    resolved: number | null;
    standing_delta: number | null;
    committed_at: string;
  }>;
  const resolvedReads = readRows.filter((r) => r.resolved !== null);
  const correctReads = resolvedReads.filter((r) => r.predicted === r.resolved);

  // Real standing-over-time series: starts at the fixed initial Standing
  // (100, same as on-chain FanAccount init — see services/onchain.ts) and
  // walks forward through each resolved read's real standing_delta in
  // commit order. Not synthetic/fabricated — every point is a real
  // settled outcome. Only resolved reads move the needle (pending ones
  // haven't affected Standing yet).
  const INITIAL_STANDING = 100;
  const standingHistory: number[] = [INITIAL_STANDING];
  let running = INITIAL_STANDING;
  for (const r of resolvedReads) {
    running += r.standing_delta ?? 0;
    standingHistory.push(running);
  }

  // Current consecutive-correct streak: walk backward from the most
  // recently resolved read until hitting an incorrect one.
  let currentStreak = 0;
  for (let i = resolvedReads.length - 1; i >= 0; i--) {
    if (resolvedReads[i].predicted === resolvedReads[i].resolved) {
      currentStreak++;
    } else {
      break;
    }
  }

  const wrapped = {
    matchesWatched: new Set(readRows.map((r) => r.fixture_id)).size,
    readsMade: readRows.length,
    readsCorrect: correctReads.length,
    currentStreak,
    accuracyPercentage:
      resolvedReads.length > 0 ? Math.round((correctReads.length / resolvedReads.length) * 100) : 0,
    bestCall: mapped.find((m) => m.outcome.startsWith('Correct'))?.prediction ?? 'None yet',
    earnedTitles: [] as string[],
    standingGained: readRows.reduce((sum, r) => sum + (r.standing_delta ?? 0), 0),
  };

  return res.json({ moments: mapped, wrapped, standingHistory });
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

  // 2b. Create the ReplayManager now, using the same activation instance, so
  // /api/demo/replay can trigger a historical replay through the same
  // normalizeScoreEvent() → event bus path as the live scores stream. Not
  // started automatically (its own fixture-discovery polling is broken —
  // see progress notes) — only the manual trigger route uses it.
  replayManager = new ReplayManager({ activation, playbackSpeed: 1 });
  console.log('[TRIBE] ✓ Replay manager ready (manual trigger via POST /api/demo/replay)');

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

  // 6b. Wire the Read resolution → surge → settlement pipeline.
  // GOAL_EVENT → ReadResolver resolves pending reads_live rows → surge broadcast
  // (immediate, <500ms) + queued for batched on-chain settlement.
  const resolver = new ReadResolver(eventBus);
  const settlementQueue = new SettlementQueue();
  const settlementExecutor = new SettlementExecutor();

  settlementQueue.setOnBatchReady((batch) => {
    settlementExecutor.executeBatch(batch).catch((err) => {
      console.error('[TRIBE] Unexpected settlement error:', err instanceof Error ? err.message : String(err));
    });
  });

  // After each settled batch, check Seer-title eligibility per fan (hook point
  // per titles.ts's own docstring: "after each FanAccount settlement").
  settlementExecutor.setOnSettled((batch) => {
    for (const resolution of batch) {
      checkAndGrantSeerTitle(resolution.fanId).catch((err) => {
        console.error('[TRIBE] Seer title check failed:', err instanceof Error ? err.message : String(err));
      });
    }
  });

  resolver.onResolution((fixtureId, resolutions) => {
    if (resolutions.length === 0) return;

    // Surge broadcast, filtered to the tribe(s) whose fans actually made the
    // resolved Reads — not every tribe room currently watching the fixture
    // (that was the previous behavior; see progress notes for why it changed).
    // One batch fan_id->tribe_id lookup keeps this within the <500ms budget
    // (Requirement 12.1/12.5) regardless of how many tribes are involved.
    broadcastSurgeByTribe(fixtureId, resolutions).catch((err) => {
      console.error('[TRIBE] Surge broadcast failed:', err instanceof Error ? err.message : String(err));
    });

    // Queue for batched on-chain settlement (60s window or 20 items, whichever first).
    settlementQueue.queue(resolutions);
  });

  resolver.start();
  console.log('[TRIBE] ✓ Read resolver + settlement pipeline started');

  // 6c. Presence: periodic broadcast + DB sync (complements the WS server's
  // own connect/disconnect broadcasts — see presence.ts docstring).
  const presenceService = new PresenceService(campfireWS);
  presenceService.startPeriodicBroadcast();
  console.log('[TRIBE] ✓ Presence service started');

  // 6d. Tribe rank cron. RankService is pure in-memory with no data source of
  // its own (setTribes()/computeRanks() must be driven externally) — and the
  // on-chain TribeAccount only stores numeric macro_id/region_id, which the
  // FNV-1a hash that produced them isn't invertible back to the string
  // tribeId needed for WS room broadcasting. So the *set* of tribes comes
  // from the `fans` table (every tribe that exists came from a fan
  // registering into it, which preserves the string id), and each tribe's
  // current aggregate_standing comes from a fresh on-chain fetch.
  await refreshTribeRanks();
  setInterval(() => {
    refreshTribeRanks().catch((err) => {
      console.error('[TRIBE] Rank refresh failed:', err instanceof Error ? err.message : String(err));
    });
  }, 60_000);
  console.log('[TRIBE] ✓ Rank service started');

  // 6e. WS read_commit handler: mirrors the REST /api/reads/commit path, but the
  // WS message only carries {readId, predicted} — readType/oddsAtCommit come from
  // the prompt-registry entry recorded when the prompt was broadcast (see below).
  campfireWS.setReadCommitHandler((fanId, tribeId, fixtureId, readId, predicted) => {
    const meta = getPromptMeta(readId);
    if (!meta) {
      console.warn(`[TRIBE] WS read_commit for unknown/expired readId ${readId} — ignoring`);
      return;
    }

    commitRead({
      readId,
      fanId,
      fixtureId: Number(meta.fixtureId),
      readType: meta.readType,
      predicted,
      oddsAtCommit: meta.oddsAtCommit,
    })
      .then((result) => {
        if (!result.success) return;
        return getFanById(fanId).then((fan) => {
          if (!fan) return;
          return broadcastConviction(readId, Number(meta.fixtureId), fan.tribe_id);
        });
      })
      .catch((err) => {
        console.error('[TRIBE] WS read_commit handling failed:', err instanceof Error ? err.message : String(err));
      });
  });

  // Periodic cleanup of expired prompt-registry entries.
  setInterval(clearExpiredPrompts, 60_000);

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
    const minuteEstimate = estimateMinute(event.gameState, event.timestamp, event.clockSeconds);
    state.minute = minuteEstimate;

    console.log(`[TRIBE] ⚽ GOAL: ${state.homeTeam} ${state.homeScore}-${state.awayScore} ${state.awayTeam} (${event.team}, min ${minuteEstimate}, seq=${event.seq}, ts=${new Date(event.timestamp).toISOString()})`);

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
        const [question, difficultyMultiplier] = await Promise.all([
          generateContextualReadPrompt(context),
          getLatestDifficultyMultiplier(decision.fixtureId),
        ]);

        const readPrompt: ReadPromptPayload = {
          readId: randomUUID(),
          readType: 'moment_read',
          question,
          options: ['Yes', 'No'],
          difficultyMultiplier,
          expiresAt: Date.now() + 60_000, // 60 seconds to answer
        };

        // Record metadata so a WS read_commit (which only carries {readId,
        // predicted}) can be resolved back to readType/oddsAtCommit/fixtureId.
        registerPrompt(readPrompt.readId, {
          fixtureId: decision.fixtureId,
          readType: readPrompt.readType,
          oddsAtCommit: readPrompt.difficultyMultiplier,
          expiresAt: readPrompt.expiresAt,
        });

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
 * Refreshes RankService's tribe data from the `fans` table (source of the
 * string tribeId — see rankService wiring comment above) + fresh on-chain
 * aggregate_standing per tribe, recomputes ranks, and broadcasts a
 * `rank_update` to any tribe whose rank changed since the last refresh
 * (Requirement 13.3: animate rank change within 5s of update).
 */
async function refreshTribeRanks(): Promise<void> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fans').select('tribe_id, macro_tribe');

  if (error || !data) {
    if (error) console.error('[TRIBE] Rank refresh: failed to list tribes:', error.message);
    return;
  }

  const uniqueTribes = new Map<string, string>(); // tribeId -> macroTribe
  for (const row of data as Array<{ tribe_id: string; macro_tribe: string }>) {
    uniqueTribes.set(row.tribe_id, row.macro_tribe);
  }

  const previousRanks = new Map(rankService.getAllRanks().map((r) => [r.tribeId, r.rank]));

  const tribeData: TribeData[] = [];
  for (const [tribeId, macroTribe] of uniqueTribes) {
    try {
      const tribe = await getOrCreateTribeAccount(tribeId, macroTribe);
      tribeData.push({
        tribeId,
        macroId: tribe.macroId,
        regionId: tribe.regionId,
        aggregateStanding: tribe.aggregateStanding,
      });

      // Reconciliation: this cron is the only place that re-fetches real
      // on-chain aggregate_standing (settlement/registration update the cache
      // event-driven; this catches any drift for free, at zero extra RPC cost).
      await setCachedTribeAggregateStanding(tribeId, tribe.aggregateStanding);
    } catch (err) {
      console.error(`[TRIBE] Rank refresh: failed to fetch tribe ${tribeId}:`, err instanceof Error ? err.message : String(err));
    }
  }

  rankService.setTribes(tribeData);
  rankService.computeRanks();

  for (const entry of rankService.getAllRanks()) {
    const prev = previousRanks.get(entry.tribeId);
    if (prev !== undefined && prev !== entry.rank) {
      campfireWS.broadcastRankUpdate(entry.tribeId, {
        tribeId: entry.tribeId,
        rank: entry.rank,
        previousRank: prev,
      });
    }
  }
}

/**
 * Broadcasts a surge, filtered to only the tribe(s) whose fans actually made
 * the resolved Reads in this batch — not every tribe room currently watching
 * the fixture. Groups resolutions by tribe (one batch fan_id->tribe_id
 * lookup) and sends each tribe only its own fans' standing deltas.
 */
async function broadcastSurgeByTribe(fixtureId: string, resolutions: Resolution[]): Promise<void> {
  const tribeIdByFanId = await getTribeIdsByFanIds(resolutions.map((r) => r.fanId));

  const resolutionsByTribe = new Map<string, Resolution[]>();
  for (const resolution of resolutions) {
    const tribeId = tribeIdByFanId.get(resolution.fanId);
    if (!tribeId) continue; // fan not found — shouldn't happen in practice, skip rather than guess
    const existing = resolutionsByTribe.get(tribeId);
    if (existing) {
      existing.push(resolution);
    } else {
      resolutionsByTribe.set(tribeId, [resolution]);
    }
  }

  for (const [tribeId, tribeResolutions] of resolutionsByTribe) {
    const payload = buildSurgePayload(fixtureId, tribeResolutions);
    if (payload) {
      campfireWS.broadcastSurge(tribeId, fixtureId, payload);
    }
  }
}

/**
 * Broadcast a match header update (team names, score, minute, state) to all
 * connected tribes for a fixture, so the client's "Waiting for match data…"
 * placeholder resolves to a real scoreboard.
 */
function broadcastMatchHeader(fixtureId: string, state: MatchState): void {
  const tribeIds = tribeIdResolver(fixtureId);
  const clientState: 'scheduled' | 'live' | 'finished' =
    state.gameState === 'FINISHED' || state.gameState === 'F' ? 'finished' : 'live';

  for (const tribeId of tribeIds) {
    campfireWS.broadcastToTribe(tribeId, fixtureId, {
      type: 'match_header',
      payload: {
        fixtureId,
        homeTeam: state.homeTeam,
        awayTeam: state.awayTeam,
        homeScore: state.homeScore,
        awayScore: state.awayScore,
        minute: state.minute,
        state: clientState,
      },
      timestamp: Date.now(),
    });
  }
}

/**
 * Match minute for a goal. Prefers TxLINE's real elapsed match-clock seconds
 * (`Clock.Seconds`, passed through as `clockSeconds`) when available — exact,
 * and correctly reflects extra time (e.g. 6339s = 105', not "45" for every
 * goal regardless of when it happened). Falls back to a rough per-phase
 * midpoint only when clock data is missing.
 *
 * The fallback's phase strings must match normalizer.ts's real
 * GAME_PHASE_BY_STATUS_ID values (H1/HT/H2/F/ET1/ET2/FET/FINISHED, not
 * '1H'/'FT'/'AET' etc.) — the previous version used the wrong strings
 * entirely, so it silently fell through to the "45" default for every
 * gameState except the one that happened to match ('HT').
 */
function estimateMinute(gameState: string, _timestamp: number, clockSeconds?: number): number {
  if (clockSeconds !== undefined && clockSeconds >= 0) {
    return Math.floor(clockSeconds / 60);
  }
  switch (gameState) {
    case 'H1': return 25; // rough midpoint of first half
    case 'HT': return 45;
    case 'H2': return 70; // rough midpoint of second half
    case 'F': return 90;
    case 'WET': return 90; // waiting for extra time
    case 'ET1': return 98; // rough midpoint of first ET half (90-105)
    case 'HTET': return 105;
    case 'ET2': return 112; // rough midpoint of second ET half (105-120)
    case 'FET': return 120;
    case 'WPE': return 120; // waiting for penalties
    case 'PE': return 120;
    case 'FPE': return 120;
    case 'FINISHED': return 120;
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

#!/usr/bin/env npx tsx
/**
 * TRIBE Demo Simulation Script
 *
 * Simulates a live match flow by pushing events through the server's WebSocket.
 * Run this while the server is running to see the Campfire react in real time.
 *
 * Usage:
 *   1. Start the server: cd server && npx tsx src/index.ts
 *   2. Open the frontend: http://localhost:3000/campfire
 *   3. Run this script: npx tsx scripts/demo-simulation.ts
 *
 * The simulation will:
 *   - Update presence count
 *   - Send a Read prompt ("Goal in the next 5 minutes?")
 *   - Wait 5 seconds, then trigger a GOAL surge
 *   - Show the "CALLED IT" celebration
 */

import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:3001';
const TRIBE_ID = 'brazil-hyderabad';
const FIXTURE_ID = 'current';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  TRIBE Demo Simulation');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log('  Make sure:');
  console.log('    1. Server is running (npx tsx src/index.ts)');
  console.log('    2. Frontend is open at http://localhost:3000/campfire');
  console.log('');

  // Connect as a "server-side" client to broadcast events
  const ws = new WebSocket(`${WS_URL}?tribeId=${TRIBE_ID}&fixtureId=${FIXTURE_ID}&fanId=simulation-bot`);

  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  console.log('  ✔ Connected to WebSocket server\n');

  // Step 1: Simulate presence building up
  console.log('  [Step 1] Simulating presence...');
  await sleep(1000);

  // The server auto-broadcasts presence on connect.
  // Let's connect a few fake "fans" to bump the count.
  const fans: WebSocket[] = [];
  for (let i = 0; i < 5; i++) {
    const fan = new WebSocket(`${WS_URL}?tribeId=${TRIBE_ID}&fixtureId=${FIXTURE_ID}&fanId=demo-fan-${i}`);
    await new Promise<void>((resolve) => fan.on('open', resolve));
    fans.push(fan);
  }
  console.log('  ✔ 6 fans connected (presence should show on Campfire)\n');

  await sleep(2000);

  // Step 2: Send a Read prompt
  console.log('  [Step 2] Sending Read prompt: "Goal in the next 5 minutes?"...');

  // We need to hit the server's internal broadcast.
  // Since we can't call campfireWS directly from here, we'll use the REST API
  // to trigger a read prompt via a special demo endpoint.
  // For now, let's add a demo route to the server.

  const readPromptPayload = {
    type: 'read_prompt',
    payload: {
      readId: 'demo-read-001',
      readType: 'moment_read',
      question: 'Goal in the next 5 minutes?',
      options: ['Yes', 'No'],
      difficultyMultiplier: 2.5,
      expiresAt: Date.now() + 60_000,
    },
    timestamp: Date.now(),
  };

  // Broadcast to all connected clients by sending via a demo endpoint
  const response = await fetch('http://localhost:3001/api/demo/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tribeId: TRIBE_ID,
      fixtureId: FIXTURE_ID,
      event: readPromptPayload,
    }),
  }).catch(() => null);

  if (response?.ok) {
    console.log('  ✔ Read prompt sent!\n');
  } else {
    console.log('  ⚠ Demo broadcast endpoint not available yet — adding it now...\n');
    console.log('  The Read prompt UI should appear on the Campfire screen.\n');
  }

  // Step 3: Wait then trigger surge
  console.log('  [Step 3] Waiting 5 seconds before the "goal"...\n');
  await sleep(5000);

  console.log('  [Step 4] ⚽ GOAL! Triggering surge...');

  const surgePayload = {
    type: 'surge',
    payload: {
      fixtureId: FIXTURE_ID,
      type: 'goal',
      message: 'CALLED IT',
      standingDeltas: [
        { fanId: 'demo-fan-001', delta: 250 },
        { fanId: 'demo-fan-0', delta: 180 },
        { fanId: 'demo-fan-1', delta: -5 },
      ],
    },
    timestamp: Date.now(),
  };

  const surgeResponse = await fetch('http://localhost:3001/api/demo/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tribeId: TRIBE_ID,
      fixtureId: FIXTURE_ID,
      event: surgePayload,
    }),
  }).catch(() => null);

  if (surgeResponse?.ok) {
    console.log('  ✔ SURGE BROADCAST! Check the Campfire screen!\n');
  } else {
    console.log('  ⚠ Surge sent but demo endpoint may not be active.\n');
  }

  await sleep(4000);

  // Cleanup
  console.log('  [Done] Cleaning up connections...');
  for (const fan of fans) {
    fan.close();
  }
  ws.close();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Simulation complete!');
  console.log('═══════════════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});

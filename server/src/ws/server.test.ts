import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server as HTTPServer } from 'node:http';
import { WebSocket } from 'ws';
import { CampfireWSServer } from './server.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on('open', resolve);
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket, timeout = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('waitForMessage timed out')), timeout);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function waitForMessageOfType(ws: WebSocket, type: string, timeout = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`waitForMessageOfType(${type}) timed out`)), timeout);
    const handler = (data: any) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.on('close', () => resolve());
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function drainMessages(ws: WebSocket, ms = 100): Promise<any[]> {
  return new Promise((resolve) => {
    const messages: any[] = [];
    const handler = (data: any) => {
      messages.push(JSON.parse(data.toString()));
    };
    ws.on('message', handler);
    setTimeout(() => {
      ws.off('message', handler);
      resolve(messages);
    }, ms);
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CampfireWSServer', () => {
  let httpServer: HTTPServer;
  let campfireWS: CampfireWSServer;
  let port: number;
  const clients: WebSocket[] = [];

  beforeEach(async () => {
    campfireWS = new CampfireWSServer();
    httpServer = createServer();
    campfireWS.attach(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(async () => {
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close();
      }
    }
    clients.length = 0;

    campfireWS.shutdown();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  function connect(tribeId: string, fixtureId: string, fanId?: string): WebSocket {
    const params = new URLSearchParams({ tribeId, fixtureId });
    if (fanId) params.set('fanId', fanId);
    const ws = new WebSocket(`ws://localhost:${port}?${params.toString()}`);
    clients.push(ws);
    return ws;
  }

  describe('Connection lifecycle', () => {
    it('accepts connections with valid tribeId and fixtureId', async () => {
      const ws = connect('tribe-1', 'fixture-100');
      await waitForOpen(ws);
      expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    it('rejects connections missing tribeId', async () => {
      const ws = new WebSocket(`ws://localhost:${port}?fixtureId=100`);
      clients.push(ws);
      await waitForClose(ws);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    it('rejects connections missing fixtureId', async () => {
      const ws = new WebSocket(`ws://localhost:${port}?tribeId=tribe-1`);
      clients.push(ws);
      await waitForClose(ws);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    it('tracks presence count on connection', async () => {
      const ws1 = connect('tribe-1', 'fixture-100');
      await waitForOpen(ws1);
      await delay(50);

      expect(campfireWS.getPresenceCount('tribe-1', 'fixture-100')).toBe(1);

      const ws2 = connect('tribe-1', 'fixture-100');
      await waitForOpen(ws2);
      await delay(50);

      expect(campfireWS.getPresenceCount('tribe-1', 'fixture-100')).toBe(2);
    });

    it('decrements presence count on disconnection', async () => {
      const ws1 = connect('tribe-1', 'fixture-100');
      await waitForOpen(ws1);

      const ws2 = connect('tribe-1', 'fixture-100');
      await waitForOpen(ws2);
      await delay(50);

      expect(campfireWS.getPresenceCount('tribe-1', 'fixture-100')).toBe(2);

      ws2.close();
      await waitForClose(ws2);
      await delay(50);

      expect(campfireWS.getPresenceCount('tribe-1', 'fixture-100')).toBe(1);
    });

    it('isolates rooms by tribeId and fixtureId', async () => {
      const ws1 = connect('tribe-1', 'fixture-100');
      const ws2 = connect('tribe-2', 'fixture-100');
      const ws3 = connect('tribe-1', 'fixture-200');

      await Promise.all([waitForOpen(ws1), waitForOpen(ws2), waitForOpen(ws3)]);
      await delay(50);

      expect(campfireWS.getPresenceCount('tribe-1', 'fixture-100')).toBe(1);
      expect(campfireWS.getPresenceCount('tribe-2', 'fixture-100')).toBe(1);
      expect(campfireWS.getPresenceCount('tribe-1', 'fixture-200')).toBe(1);
    });
  });

  describe('Heartbeat / Ping', () => {
    it('responds to client ping with pong', async () => {
      const ws = connect('tribe-1', 'fixture-100');
      await waitForOpen(ws);
      // Drain initial presence message
      await drainMessages(ws, 50);

      ws.send(JSON.stringify({ type: 'ping' }));
      const response = await waitForMessageOfType(ws, 'pong');

      expect(response.type).toBe('pong');
      expect(response.timestamp).toBeDefined();
    });
  });

  describe('Broadcast helpers', () => {
    it('broadcastPresence sends presence to all room members', async () => {
      const ws1 = connect('tribe-1', 'fixture-100');
      const ws2 = connect('tribe-1', 'fixture-100');
      await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);
      // Drain initial connection presence messages
      await drainMessages(ws1, 100);
      await drainMessages(ws2, 100);

      // Set up listeners before broadcasting
      const msg1Promise = waitForMessage(ws1);
      const msg2Promise = waitForMessage(ws2);

      campfireWS.broadcastPresence('tribe-1', 'fixture-100', 42);

      const [msg1, msg2] = await Promise.all([msg1Promise, msg2Promise]);

      expect(msg1.type).toBe('presence');
      expect(msg1.payload.count).toBe(42);
      expect(msg2.type).toBe('presence');
      expect(msg2.payload.count).toBe(42);
    });

    it('broadcastConviction sends conviction signal to room', async () => {
      const ws = connect('tribe-1', 'fixture-100');
      await waitForOpen(ws);
      await drainMessages(ws, 50);

      const msgPromise = waitForMessage(ws);
      campfireWS.broadcastConviction('tribe-1', 'fixture-100', {
        readId: 'read-1',
        signal: 0.78,
        participantCount: 15,
      });

      const msg = await msgPromise;
      expect(msg.type).toBe('conviction');
      expect(msg.payload.readId).toBe('read-1');
      expect(msg.payload.signal).toBe(0.78);
      expect(msg.payload.participantCount).toBe(15);
    });

    it('broadcastSurge sends surge data to room', async () => {
      const ws = connect('tribe-1', 'fixture-100');
      await waitForOpen(ws);
      await drainMessages(ws, 50);

      const msgPromise = waitForMessage(ws);
      campfireWS.broadcastSurge('tribe-1', 'fixture-100', {
        fixtureId: 'fixture-100',
        type: 'goal',
        message: 'CALLED IT',
        standingDeltas: [{ fanId: 'fan-1', delta: 250 }],
      });

      const msg = await msgPromise;
      expect(msg.type).toBe('surge');
      expect(msg.payload.message).toBe('CALLED IT');
      expect(msg.payload.standingDeltas[0].delta).toBe(250);
    });

    it('broadcastReadPrompt sends read prompt to room', async () => {
      const ws = connect('tribe-1', 'fixture-100');
      await waitForOpen(ws);
      await drainMessages(ws, 50);

      const msgPromise = waitForMessage(ws);
      campfireWS.broadcastReadPrompt('tribe-1', 'fixture-100', {
        readId: 'read-99',
        readType: 'moment_read',
        question: 'Next goal in 5 minutes?',
        options: ['Yes', 'No'],
        difficultyMultiplier: 2.5,
        expiresAt: Date.now() + 60_000,
      });

      const msg = await msgPromise;
      expect(msg.type).toBe('read_prompt');
      expect(msg.payload.readId).toBe('read-99');
      expect(msg.payload.question).toBe('Next goal in 5 minutes?');
      expect(msg.payload.difficultyMultiplier).toBe(2.5);
    });

    it('broadcastKeeperInject sends keeper message to room', async () => {
      const ws = connect('tribe-1', 'fixture-100');
      await waitForOpen(ws);
      await drainMessages(ws, 50);

      const msgPromise = waitForMessage(ws);
      campfireWS.broadcastKeeperInject('tribe-1', 'fixture-100', {
        message: 'GOAL. Your tribe called it.',
        emotion: 'celebration',
      });

      const msg = await msgPromise;
      expect(msg.type).toBe('keeper_inject');
      expect(msg.payload.message).toBe('GOAL. Your tribe called it.');
      expect(msg.payload.emotion).toBe('celebration');
    });

    it('does not send messages to clients in a different room', async () => {
      const ws1 = connect('tribe-1', 'fixture-100');
      const ws2 = connect('tribe-2', 'fixture-200');
      await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);
      await drainMessages(ws2, 100);

      const messages = drainMessages(ws2, 200);
      campfireWS.broadcastPresence('tribe-1', 'fixture-100', 5);
      const received = await messages;

      expect(received.length).toBe(0);
    });
  });

  describe('Queries', () => {
    it('getTotalConnections returns all connected clients', async () => {
      const ws1 = connect('tribe-1', 'fixture-100');
      const ws2 = connect('tribe-2', 'fixture-200');
      const ws3 = connect('tribe-1', 'fixture-100');

      await Promise.all([waitForOpen(ws1), waitForOpen(ws2), waitForOpen(ws3)]);
      await delay(50);

      expect(campfireWS.getTotalConnections()).toBe(3);
    });

    it('getPresenceCount returns 0 for empty rooms', () => {
      expect(campfireWS.getPresenceCount('nonexistent', 'none')).toBe(0);
    });
  });

  describe('Shutdown', () => {
    it('closes all connections on shutdown', async () => {
      const ws1 = connect('tribe-1', 'fixture-100');
      const ws2 = connect('tribe-1', 'fixture-100');
      await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

      const close1 = waitForClose(ws1);
      const close2 = waitForClose(ws2);

      campfireWS.shutdown();

      await Promise.all([close1, close2]);
      expect(campfireWS.getTotalConnections()).toBe(0);
    });
  });
});

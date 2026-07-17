import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HTTPServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type {
  OutboundWSMessage,
  ConvictionPayload,
  SurgePayload,
  KeeperInjectPayload,
  ReadPromptPayload,
} from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000; // Client pings every 30s
const STALE_THRESHOLD_MS = 60_000; // Remove after 60s without ping

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConnectedClient {
  ws: WebSocket;
  tribeId: string;
  fixtureId: string;
  fanId?: string;
  lastPing: number;
}

/**
 * Room key format: `${tribeId}:${fixtureId}`
 */
function roomKey(tribeId: string, fixtureId: string): string {
  return `${tribeId}:${fixtureId}`;
}

// ─── CampfireWSServer Class ──────────────────────────────────────────────────

export class CampfireWSServer {
  private wss: WebSocketServer | null = null;
  private rooms: Map<string, Set<ConnectedClient>> = new Map();
  private clients: Map<WebSocket, ConnectedClient> = new Map();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Attach the WebSocket server to an existing HTTP server instance.
   */
  attach(httpServer: HTTPServer): void {
    this.wss = new WebSocketServer({ server: httpServer });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    // Start heartbeat sweeper to remove stale connections
    this.heartbeatTimer = setInterval(() => {
      this.sweepStaleConnections();
    }, HEARTBEAT_INTERVAL_MS);

    console.log('[CampfireWS] WebSocket server attached to HTTP server');
  }

  /**
   * Handle a new WebSocket connection.
   * Expects query params: ?tribeId=xxx&fixtureId=yyy&fanId=zzz (fanId optional)
   */
  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const tribeId = url.searchParams.get('tribeId');
    const fixtureId = url.searchParams.get('fixtureId');
    const fanId = url.searchParams.get('fanId') || undefined;

    if (!tribeId || !fixtureId) {
      ws.close(4000, 'Missing tribeId or fixtureId query parameters');
      return;
    }

    const client: ConnectedClient = {
      ws,
      tribeId,
      fixtureId,
      fanId,
      lastPing: Date.now(),
    };

    // Track client
    this.clients.set(ws, client);

    // Add to room
    const key = roomKey(tribeId, fixtureId);
    if (!this.rooms.has(key)) {
      this.rooms.set(key, new Set());
    }
    this.rooms.get(key)!.add(client);

    // Broadcast updated presence count
    this.broadcastPresence(tribeId, fixtureId, this.getPresenceCount(tribeId, fixtureId));

    // Handle incoming messages (pings)
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') {
          client.lastPing = Date.now();
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch {
        // Ignore malformed messages
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      this.handleDisconnection(ws);
    });

    ws.on('error', () => {
      this.handleDisconnection(ws);
    });

    console.log(
      `[CampfireWS] Client connected: tribe=${tribeId} fixture=${fixtureId} fan=${fanId || 'anonymous'}`
    );
  }

  /**
   * Handle client disconnection: remove from room and broadcast updated presence.
   */
  private handleDisconnection(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const key = roomKey(client.tribeId, client.fixtureId);
    const room = this.rooms.get(key);
    if (room) {
      room.delete(client);
      if (room.size === 0) {
        this.rooms.delete(key);
      }
    }

    this.clients.delete(ws);

    // Broadcast updated presence count
    this.broadcastPresence(
      client.tribeId,
      client.fixtureId,
      this.getPresenceCount(client.tribeId, client.fixtureId)
    );

    console.log(
      `[CampfireWS] Client disconnected: tribe=${client.tribeId} fixture=${client.fixtureId}`
    );
  }

  /**
   * Sweep stale connections that haven't sent a ping within the threshold.
   */
  private sweepStaleConnections(): void {
    const now = Date.now();
    for (const [ws, client] of this.clients.entries()) {
      if (now - client.lastPing > STALE_THRESHOLD_MS) {
        console.log(
          `[CampfireWS] Removing stale client: tribe=${client.tribeId} fixture=${client.fixtureId}`
        );
        ws.close(4001, 'Connection timed out');
        this.handleDisconnection(ws);
      }
    }
  }

  // ─── Broadcast Helpers ───────────────────────────────────────────────────

  /**
   * Send a message to all clients in a room (tribeId + fixtureId).
   */
  broadcastToTribe(tribeId: string, fixtureId: string, message: OutboundWSMessage): void {
    const key = roomKey(tribeId, fixtureId);
    const room = this.rooms.get(key);
    if (!room) return;

    const payload = JSON.stringify(message);
    for (const client of room) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  }

  /**
   * Broadcast presence count update to all tribe members in a fixture room.
   */
  broadcastPresence(tribeId: string, fixtureId: string, count: number): void {
    this.broadcastToTribe(tribeId, fixtureId, {
      type: 'presence',
      payload: { tribeId, fixtureId, count },
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast conviction signal update to all tribe members.
   */
  broadcastConviction(tribeId: string, fixtureId: string, signal: ConvictionPayload): void {
    this.broadcastToTribe(tribeId, fixtureId, {
      type: 'conviction',
      payload: signal,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast surge moment to all tribe members.
   */
  broadcastSurge(tribeId: string, fixtureId: string, surgeData: SurgePayload): void {
    this.broadcastToTribe(tribeId, fixtureId, {
      type: 'surge',
      payload: surgeData,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast a Read prompt to all tribe members.
   */
  broadcastReadPrompt(tribeId: string, fixtureId: string, prompt: ReadPromptPayload): void {
    this.broadcastToTribe(tribeId, fixtureId, {
      type: 'read_prompt',
      payload: prompt,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast a Keeper inject message to all tribe members.
   */
  broadcastKeeperInject(tribeId: string, fixtureId: string, message: KeeperInjectPayload): void {
    this.broadcastToTribe(tribeId, fixtureId, {
      type: 'keeper_inject',
      payload: message,
      timestamp: Date.now(),
    });
  }

  // ─── Queries ─────────────────────────────────────────────────────────────

  /**
   * Get the number of connected clients in a room.
   */
  getPresenceCount(tribeId: string, fixtureId: string): number {
    const key = roomKey(tribeId, fixtureId);
    const room = this.rooms.get(key);
    return room ? room.size : 0;
  }

  /**
   * Get all active room keys with their tribeId and fixtureId.
   * Used by PresenceService for periodic broadcast.
   */
  getActiveRooms(): Array<{ tribeId: string; fixtureId: string; count: number }> {
    const result: Array<{ tribeId: string; fixtureId: string; count: number }> = [];
    for (const [key, room] of this.rooms.entries()) {
      const [tribeId, fixtureId] = key.split(':');
      result.push({ tribeId, fixtureId, count: room.size });
    }
    return result;
  }

  /**
   * Get total connected clients across all rooms.
   */
  getTotalConnections(): number {
    return this.clients.size;
  }

  /**
   * Gracefully shutdown the WebSocket server.
   */
  shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Close all client connections
    for (const [ws] of this.clients.entries()) {
      ws.close(1001, 'Server shutting down');
    }

    this.rooms.clear();
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    console.log('[CampfireWS] WebSocket server shut down');
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────────────

export const campfireWS = new CampfireWSServer();

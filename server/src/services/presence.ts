/**
 * PresenceService — Periodic presence broadcast and database sync.
 *
 * The WebSocket server (CampfireWSServer) already handles:
 *   - Room tracking (tribeId:fixtureId → Set of connections)
 *   - Client ping/pong (updates lastPing timestamp)
 *   - Stale sweep every 30s (removes clients with lastPing > 60s)
 *   - broadcastPresence(tribeId, fixtureId, count) on connect/disconnect
 *
 * This service adds:
 *   - Periodic 5s broadcast so all clients stay in sync even without new connections
 *   - Database sync (upsert tribes_live) for persistence and cross-service reads
 *
 * Requirements: 7.1, 7.2
 */

import type { CampfireWSServer } from '../ws/server.js';
import { getSupabaseClient } from '../lib/supabase.js';

export class PresenceService {
  private wsServer: CampfireWSServer;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;

  constructor(wsServer: CampfireWSServer) {
    this.wsServer = wsServer;
  }

  /**
   * Start periodic presence broadcast to all active rooms.
   * Default interval: 5000ms (5 seconds).
   */
  startPeriodicBroadcast(intervalMs = 5000): void {
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
    }

    this.broadcastTimer = setInterval(() => {
      this.broadcastAllRooms();
    }, intervalMs);

    console.log(`[PresenceService] Periodic broadcast started (${intervalMs}ms interval)`);
  }

  /**
   * Broadcast current presence count to all active rooms and sync to database.
   */
  broadcastAllRooms(): void {
    const rooms = this.wsServer.getActiveRooms();

    for (const { tribeId, fixtureId, count } of rooms) {
      // Broadcast via WebSocket to all tribe members in the room
      this.wsServer.broadcastPresence(tribeId, fixtureId, count);

      // Async sync to database (fire-and-forget, errors are logged)
      this.syncToDatabase(tribeId, fixtureId).catch((err) => {
        console.error(
          `[PresenceService] DB sync failed for tribe=${tribeId} fixture=${fixtureId}:`,
          err
        );
      });
    }
  }

  /**
   * Upsert tribes_live with the current presence count and timestamp.
   */
  async syncToDatabase(tribeId: string, fixtureId: string): Promise<void> {
    const count = this.wsServer.getPresenceCount(tribeId, fixtureId);
    const supabase = getSupabaseClient();

    const { error } = await supabase.from('tribes_live').upsert(
      {
        tribe_id: tribeId,
        live_presence: count,
        last_updated: new Date().toISOString(),
      },
      { onConflict: 'tribe_id' }
    );

    if (error) {
      throw new Error(`Supabase upsert failed: ${error.message}`);
    }
  }

  /**
   * Stop the periodic broadcast interval and clean up.
   */
  stop(): void {
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }

    console.log('[PresenceService] Stopped');
  }
}

/**
 * Unit tests for PresenceService.
 *
 * Tests periodic broadcast scheduling, room iteration,
 * database sync logic, and cleanup.
 *
 * Requirements: 7.1, 7.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PresenceService } from './presence.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock Supabase client
const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockFrom = vi.fn().mockReturnValue({ upsert: mockUpsert });

vi.mock('../lib/supabase.js', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

// Mock CampfireWSServer
function createMockWSServer(rooms: Array<{ tribeId: string; fixtureId: string; count: number }> = []) {
  return {
    getActiveRooms: vi.fn().mockReturnValue(rooms),
    getPresenceCount: vi.fn((tribeId: string, fixtureId: string) => {
      const room = rooms.find((r) => r.tribeId === tribeId && r.fixtureId === fixtureId);
      return room ? room.count : 0;
    }),
    broadcastPresence: vi.fn(),
  } as any;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PresenceService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create a PresenceService with a reference to the WS server', () => {
      const wsServer = createMockWSServer();
      const service = new PresenceService(wsServer);
      expect(service).toBeInstanceOf(PresenceService);
    });
  });

  describe('startPeriodicBroadcast', () => {
    it('should broadcast to all rooms at the specified interval', () => {
      const rooms = [
        { tribeId: 'tribe-1', fixtureId: 'fixture-1', count: 10 },
        { tribeId: 'tribe-2', fixtureId: 'fixture-2', count: 25 },
      ];
      const wsServer = createMockWSServer(rooms);
      const service = new PresenceService(wsServer);

      service.startPeriodicBroadcast(5000);

      // No broadcast yet at t=0
      expect(wsServer.broadcastPresence).not.toHaveBeenCalled();

      // Advance 5s — first broadcast fires
      vi.advanceTimersByTime(5000);
      expect(wsServer.broadcastPresence).toHaveBeenCalledTimes(2);
      expect(wsServer.broadcastPresence).toHaveBeenCalledWith('tribe-1', 'fixture-1', 10);
      expect(wsServer.broadcastPresence).toHaveBeenCalledWith('tribe-2', 'fixture-2', 25);

      // Advance another 5s — second broadcast
      vi.advanceTimersByTime(5000);
      expect(wsServer.broadcastPresence).toHaveBeenCalledTimes(4);

      service.stop();
    });

    it('should use default 5000ms interval when no argument provided', () => {
      const rooms = [{ tribeId: 'tribe-1', fixtureId: 'fixture-1', count: 5 }];
      const wsServer = createMockWSServer(rooms);
      const service = new PresenceService(wsServer);

      service.startPeriodicBroadcast();

      // At 4999ms, no broadcast
      vi.advanceTimersByTime(4999);
      expect(wsServer.broadcastPresence).not.toHaveBeenCalled();

      // At 5000ms, broadcast fires
      vi.advanceTimersByTime(1);
      expect(wsServer.broadcastPresence).toHaveBeenCalledTimes(1);

      service.stop();
    });

    it('should replace existing interval when called again', () => {
      const rooms = [{ tribeId: 'tribe-1', fixtureId: 'fixture-1', count: 3 }];
      const wsServer = createMockWSServer(rooms);
      const service = new PresenceService(wsServer);

      service.startPeriodicBroadcast(5000);
      vi.advanceTimersByTime(5000);
      expect(wsServer.broadcastPresence).toHaveBeenCalledTimes(1);

      // Restart with different interval
      service.startPeriodicBroadcast(10000);
      vi.advanceTimersByTime(5000);
      // Old interval cleared — no extra broadcast at 5s
      expect(wsServer.broadcastPresence).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5000);
      // New interval fires at 10s
      expect(wsServer.broadcastPresence).toHaveBeenCalledTimes(2);

      service.stop();
    });
  });

  describe('broadcastAllRooms', () => {
    it('should broadcast presence count for each active room', () => {
      const rooms = [
        { tribeId: 'tribe-a', fixtureId: 'fix-1', count: 42 },
        { tribeId: 'tribe-b', fixtureId: 'fix-2', count: 7 },
      ];
      const wsServer = createMockWSServer(rooms);
      const service = new PresenceService(wsServer);

      service.broadcastAllRooms();

      expect(wsServer.getActiveRooms).toHaveBeenCalledOnce();
      expect(wsServer.broadcastPresence).toHaveBeenCalledWith('tribe-a', 'fix-1', 42);
      expect(wsServer.broadcastPresence).toHaveBeenCalledWith('tribe-b', 'fix-2', 7);
    });

    it('should do nothing when no active rooms exist', () => {
      const wsServer = createMockWSServer([]);
      const service = new PresenceService(wsServer);

      service.broadcastAllRooms();

      expect(wsServer.broadcastPresence).not.toHaveBeenCalled();
    });

    it('should sync each room to the database', async () => {
      const rooms = [{ tribeId: 'tribe-x', fixtureId: 'fix-10', count: 15 }];
      const wsServer = createMockWSServer(rooms);
      const service = new PresenceService(wsServer);

      service.broadcastAllRooms();

      // Allow promises to settle
      await vi.advanceTimersByTimeAsync(0);

      expect(mockFrom).toHaveBeenCalledWith('tribes_live');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          tribe_id: 'tribe-x',
          live_presence: 15,
          last_updated: expect.any(String),
        }),
        { onConflict: 'tribe_id' }
      );
    });
  });

  describe('syncToDatabase', () => {
    it('should upsert tribes_live with correct data', async () => {
      const rooms = [{ tribeId: 'tribe-1', fixtureId: 'fix-1', count: 20 }];
      const wsServer = createMockWSServer(rooms);
      const service = new PresenceService(wsServer);

      await service.syncToDatabase('tribe-1', 'fix-1');

      expect(mockFrom).toHaveBeenCalledWith('tribes_live');
      expect(mockUpsert).toHaveBeenCalledWith(
        {
          tribe_id: 'tribe-1',
          live_presence: 20,
          last_updated: expect.any(String),
        },
        { onConflict: 'tribe_id' }
      );
    });

    it('should throw when Supabase returns an error', async () => {
      mockUpsert.mockResolvedValueOnce({ error: { message: 'DB connection failed' } });

      const rooms = [{ tribeId: 'tribe-1', fixtureId: 'fix-1', count: 5 }];
      const wsServer = createMockWSServer(rooms);
      const service = new PresenceService(wsServer);

      await expect(service.syncToDatabase('tribe-1', 'fix-1')).rejects.toThrow(
        'Supabase upsert failed: DB connection failed'
      );
    });

    it('should handle zero presence count (empty room)', async () => {
      const wsServer = createMockWSServer([]);
      const service = new PresenceService(wsServer);

      await service.syncToDatabase('tribe-empty', 'fix-99');

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          tribe_id: 'tribe-empty',
          live_presence: 0,
        }),
        { onConflict: 'tribe_id' }
      );
    });
  });

  describe('stop', () => {
    it('should stop the periodic broadcast interval', () => {
      const rooms = [{ tribeId: 'tribe-1', fixtureId: 'fix-1', count: 10 }];
      const wsServer = createMockWSServer(rooms);
      const service = new PresenceService(wsServer);

      service.startPeriodicBroadcast(5000);
      vi.advanceTimersByTime(5000);
      expect(wsServer.broadcastPresence).toHaveBeenCalledTimes(1);

      service.stop();

      // After stop, no more broadcasts
      vi.advanceTimersByTime(10000);
      expect(wsServer.broadcastPresence).toHaveBeenCalledTimes(1);
    });

    it('should be safe to call stop multiple times', () => {
      const wsServer = createMockWSServer([]);
      const service = new PresenceService(wsServer);

      service.startPeriodicBroadcast(5000);
      service.stop();
      service.stop(); // Should not throw
    });

    it('should be safe to call stop without starting', () => {
      const wsServer = createMockWSServer([]);
      const service = new PresenceService(wsServer);
      service.stop(); // Should not throw
    });
  });
});

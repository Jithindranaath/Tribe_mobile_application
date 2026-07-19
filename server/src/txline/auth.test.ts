import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TxLINEAuth } from './auth.js';

// Mock getEnvConfig to avoid requiring real environment variables
vi.mock('../config/env.js', () => ({
  getEnvConfig: () => ({
    txlineApiBaseUrl: 'https://txline-dev.txodds.com/api',
  }),
}));

describe('TxLINEAuth', () => {
  let auth: TxLINEAuth;

  beforeEach(() => {
    auth = new TxLINEAuth();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('acquireGuestJWT', () => {
    it('stores JWT and expiration on successful response', async () => {
      const mockResponse = { jwt: 'test-jwt-token', expiresIn: 3600 };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await auth.acquireGuestJWT();

      expect(result.jwt).toBe('test-jwt-token');
      expect(result.expiresIn).toBe(3600);
      expect(auth.getJWT()).toBe('test-jwt-token');
      expect(auth.isJWTExpired()).toBe(false);
    });

    it('POSTs to the correct endpoint', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ jwt: 'token', expiresIn: 3600 }),
      });

      await auth.acquireGuestJWT();

      // /auth/guest/start is at the API root, not under /api — auth.ts strips
      // the /api suffix from txlineApiBaseUrl before building this URL (the
      // real TxLINE API 404s on /api/auth/guest/start; confirmed live).
      expect(global.fetch).toHaveBeenCalledWith(
        'https://txline-dev.txodds.com/auth/guest/start',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('throws on non-OK HTTP response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'server error',
      });

      await expect(auth.acquireGuestJWT()).rejects.toThrow(
        /Failed to acquire guest JWT: 500/
      );
    });

    it('throws on malformed response (missing jwt)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ expiresIn: 3600 }),
      });

      await expect(auth.acquireGuestJWT()).rejects.toThrow(
        /Malformed response.*missing jwt\/token field/
      );
    });

    it('defaults expiresIn to 1 hour when missing (TxLINE may omit it)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ jwt: 'token' }),
      });

      const result = await auth.acquireGuestJWT();

      expect(result.jwt).toBe('token');
      expect(result.expiresIn).toBe(3600);
    });

    it('computes expiration timestamp correctly', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ jwt: 'token', expiresIn: 3600 }),
      });

      await auth.acquireGuestJWT();

      // expiresAt should be now + 3600s = 12:00 + 1h = 13:00
      const expectedExpiry = new Date('2024-06-15T13:00:00.000Z').getTime();
      expect(auth.getExpiresAt()).toBe(expectedExpiry);
    });
  });

  describe('getJWT', () => {
    it('throws when no JWT has been acquired', () => {
      expect(() => auth.getJWT()).toThrow(/No JWT acquired/);
    });

    it('throws when JWT is expired', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ jwt: 'token', expiresIn: 60 }),
      });

      await auth.acquireGuestJWT();

      // Advance time past expiration
      vi.setSystemTime(new Date('2024-06-15T12:01:01.000Z'));

      expect(() => auth.getJWT()).toThrow(/JWT has expired/);
    });

    it('returns token when not expired', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ jwt: 'my-valid-token', expiresIn: 3600 }),
      });

      await auth.acquireGuestJWT();
      expect(auth.getJWT()).toBe('my-valid-token');
    });
  });

  describe('isJWTExpired', () => {
    it('returns true when no JWT stored', () => {
      expect(auth.isJWTExpired()).toBe(true);
    });

    it('returns false within validity window', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ jwt: 'token', expiresIn: 3600 }),
      });

      await auth.acquireGuestJWT();
      expect(auth.isJWTExpired()).toBe(false);
    });

    it('returns true after expiration', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ jwt: 'token', expiresIn: 10 }),
      });

      await auth.acquireGuestJWT();

      // Advance past expiration
      vi.setSystemTime(new Date('2024-06-15T12:00:11.000Z'));
      expect(auth.isJWTExpired()).toBe(true);
    });
  });

  describe('clear', () => {
    it('removes stored JWT', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ jwt: 'token', expiresIn: 3600 }),
      });

      await auth.acquireGuestJWT();
      expect(auth.getJWT()).toBe('token');

      auth.clear();
      expect(auth.isJWTExpired()).toBe(true);
      expect(auth.getExpiresAt()).toBeNull();
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import { TxLINEActivation } from './activation.js';
import { TxLINEAuth } from './auth.js';

// Generate a deterministic keypair for testing
const TEST_KEYPAIR = Keypair.generate();
const TEST_KEYPAIR_JSON = JSON.stringify(Array.from(TEST_KEYPAIR.secretKey));

vi.mock('../config/env.js', () => ({
  getEnvConfig: () => ({
    txlineApiBaseUrl: 'https://txline-dev.txodds.com/api',
    txlineWalletKeypair: TEST_KEYPAIR_JSON,
  }),
}));

describe('TxLINEActivation', () => {
  let auth: TxLINEAuth;
  let activation: TxLINEActivation;

  beforeEach(() => {
    auth = new TxLINEAuth();
    activation = new TxLINEActivation(auth);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Helper to set up auth with a valid JWT so activation can proceed.
   */
  async function setupAuthWithJWT(jwt = 'test-jwt-token'): Promise<void> {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jwt, expiresIn: 3600 }),
    });
    await auth.acquireGuestJWT();
  }

  describe('activateAPIToken', () => {
    it('signs message as ${txSig}::${jwt} and POSTs to /api/token/activate', async () => {
      await setupAuthWithJWT('my-jwt');

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiToken: 'activated-token-123' }),
      });

      await activation.activateAPIToken('tx-sig-abc');

      // Verify the POST request
      expect(global.fetch).toHaveBeenCalledWith(
        'https://txline-dev.txodds.com/api/api/token/activate',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer my-jwt',
          },
        })
      );

      // Verify the body
      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.transactionSignature).toBe('tx-sig-abc');
      expect(body.leagues).toEqual([]);
      expect(typeof body.walletSignature).toBe('string');
      expect(body.walletSignature.length).toBeGreaterThan(0);
    });

    it('produces a valid Ed25519 signature of the activation message', async () => {
      await setupAuthWithJWT('jwt-for-signing');

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiToken: 'token' }),
      });

      await activation.activateAPIToken('my-tx-sig');

      // Extract the wallet signature from the POST body
      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      const walletSig = Buffer.from(body.walletSignature, 'base64');

      // Verify the signature is valid for the expected message
      const expectedMessage = 'my-tx-sig::jwt-for-signing';
      const messageBytes = new TextEncoder().encode(expectedMessage);
      const isValid = ed25519.verify(
        walletSig,
        messageBytes,
        TEST_KEYPAIR.publicKey.toBytes()
      );
      expect(isValid).toBe(true);
    });

    it('stores and returns the API token on success', async () => {
      await setupAuthWithJWT();

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiToken: 'my-api-token' }),
      });

      const result = await activation.activateAPIToken('tx-sig');
      expect(result).toBe('my-api-token');
      expect(activation.getAPIToken()).toBe('my-api-token');
    });

    it('throws on non-OK HTTP response', async () => {
      await setupAuthWithJWT();

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'invalid signature',
      });

      await expect(activation.activateAPIToken('tx-sig')).rejects.toThrow(
        /Failed to activate API token: 400/
      );
    });

    it('throws on malformed response (missing apiToken)', async () => {
      await setupAuthWithJWT();

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'wrong-field-name' }),
      });

      await expect(activation.activateAPIToken('tx-sig')).rejects.toThrow(
        /Malformed response.*missing apiToken/
      );
    });

    it('throws when no JWT is available', async () => {
      // No JWT acquired — should throw from auth.getJWT()
      await expect(activation.activateAPIToken('tx-sig')).rejects.toThrow(
        /No JWT acquired/
      );
    });

    it('uses two colons as separator in the message (empty leagues)', async () => {
      await setupAuthWithJWT('jwt123');

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiToken: 'token' }),
      });

      await activation.activateAPIToken('sig456');

      // Verify signature is for 'sig456::jwt123'
      const callArgs = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      const walletSig = Buffer.from(body.walletSignature, 'base64');

      const messageBytes = new TextEncoder().encode('sig456::jwt123');
      const isValid = ed25519.verify(
        walletSig,
        messageBytes,
        TEST_KEYPAIR.publicKey.toBytes()
      );
      expect(isValid).toBe(true);
    });
  });

  describe('getAPIToken', () => {
    it('throws when no token has been activated', () => {
      expect(() => activation.getAPIToken()).toThrow(
        /No API token activated/
      );
    });

    it('returns the stored token after activation', async () => {
      await setupAuthWithJWT();

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiToken: 'stored-token' }),
      });

      await activation.activateAPIToken('tx-sig');
      expect(activation.getAPIToken()).toBe('stored-token');
    });
  });

  describe('getAuthHeaders', () => {
    it('returns both Authorization and X-Api-Token headers', async () => {
      await setupAuthWithJWT('bearer-jwt');

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiToken: 'api-tok' }),
      });

      await activation.activateAPIToken('tx-sig');

      const headers = activation.getAuthHeaders();
      expect(headers).toEqual({
        Authorization: 'Bearer bearer-jwt',
        'X-Api-Token': 'api-tok',
      });
    });

    it('throws when JWT is not available', () => {
      // No JWT + no API token
      expect(() => activation.getAuthHeaders()).toThrow();
    });

    it('throws when API token is not available', async () => {
      await setupAuthWithJWT();
      // JWT is available but no API token
      expect(() => activation.getAuthHeaders()).toThrow(
        /No API token activated/
      );
    });
  });

  describe('hasAPIToken', () => {
    it('returns false before activation', () => {
      expect(activation.hasAPIToken()).toBe(false);
    });

    it('returns true after activation', async () => {
      await setupAuthWithJWT();

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiToken: 'token' }),
      });

      await activation.activateAPIToken('tx-sig');
      expect(activation.hasAPIToken()).toBe(true);
    });
  });

  describe('clear', () => {
    it('removes stored API token', async () => {
      await setupAuthWithJWT();

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiToken: 'token' }),
      });

      await activation.activateAPIToken('tx-sig');
      expect(activation.hasAPIToken()).toBe(true);

      activation.clear();
      expect(activation.hasAPIToken()).toBe(false);
      expect(() => activation.getAPIToken()).toThrow(/No API token activated/);
    });
  });
});

/**
 * TxLINE Guest JWT Authentication Module.
 *
 * Handles acquiring and managing a guest JWT from the TxLINE API.
 * The guest JWT is required as the Bearer token for all TxLINE API requests.
 *
 * Flow:
 *   POST /auth/guest/start → { jwt, expiresIn }
 *   Store JWT + computed expiration timestamp in memory.
 */

import { getEnvConfig } from '../config/env.js';

export interface GuestJWTResponse {
  jwt: string;
  expiresIn: number; // seconds until expiry
}

interface StoredJWT {
  token: string;
  expiresAt: number; // Unix timestamp in ms when the JWT expires
}

/**
 * TxLINEAuth manages guest JWT lifecycle for the TxLINE API.
 *
 * Usage:
 *   const auth = new TxLINEAuth();
 *   await auth.acquireGuestJWT();
 *   const token = auth.getJWT(); // throws if expired
 */
export class TxLINEAuth {
  private stored: StoredJWT | null = null;

  /**
   * POST to /auth/guest/start to obtain a fresh guest JWT.
   * Stores the JWT and its computed expiration timestamp in memory.
   *
   * @returns The raw response containing jwt and expiresIn.
   * @throws If the request fails or the response is malformed.
   */
  async acquireGuestJWT(): Promise<GuestJWTResponse> {
    const { txlineApiBaseUrl } = getEnvConfig();
    // Auth endpoint is at the root, not under /api
    const baseWithoutApi = txlineApiBaseUrl.replace(/\/api\/?$/, '');
    const url = `${baseWithoutApi}/auth/guest/start`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `[TxLINEAuth] Failed to acquire guest JWT: ${response.status} ${response.statusText}` +
          (body ? ` — ${body}` : '')
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    // TxLINE may return { token } or { jwt } with optional expiresIn
    const jwt = (data.jwt || data.token) as string | undefined;
    const expiresIn = (data.expiresIn as number) || 3600; // Default 1 hour if not provided

    if (!jwt) {
      throw new Error(
        '[TxLINEAuth] Malformed response from /auth/guest/start: missing jwt/token field'
      );
    }

    // Store JWT with an absolute expiration timestamp (ms)
    this.stored = {
      token: jwt,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    return { jwt, expiresIn };
  }

  /**
   * Returns the current valid JWT token.
   *
   * @throws If no JWT has been acquired or if the stored JWT has expired.
   */
  getJWT(): string {
    if (!this.stored) {
      throw new Error('[TxLINEAuth] No JWT acquired. Call acquireGuestJWT() first.');
    }

    if (this.isJWTExpired()) {
      throw new Error(
        '[TxLINEAuth] JWT has expired. Call acquireGuestJWT() to obtain a fresh token.'
      );
    }

    return this.stored.token;
  }

  /**
   * Checks whether the stored JWT is past its expiration time.
   * Returns true if expired or if no JWT has been acquired.
   */
  isJWTExpired(): boolean {
    if (!this.stored) {
      return true;
    }
    return Date.now() >= this.stored.expiresAt;
  }

  /**
   * Returns the absolute expiration timestamp (ms) of the stored JWT,
   * or null if no JWT has been acquired.
   */
  getExpiresAt(): number | null {
    return this.stored?.expiresAt ?? null;
  }

  /**
   * Clears the stored JWT. Useful for testing or forced re-authentication.
   */
  clear(): void {
    this.stored = null;
  }
}

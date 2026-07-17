/**
 * TxLINE API Token Activation Module.
 *
 * After subscribing on-chain, the backend must activate an API token:
 *   1. Get current guest JWT via TxLINEAuth
 *   2. Sign message `${txSig}::${jwt}` with the service wallet keypair
 *   3. POST to /api/token/activate with { transactionSignature, walletSignature, leagues: [] }
 *   4. Store the returned API token in memory
 *
 * The API token is required as `X-Api-Token` header alongside the Bearer JWT
 * for all TxLINE data endpoints (SSE streams, historical, fixtures).
 */

import { Keypair } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import { getEnvConfig } from '../config/env.js';
import { TxLINEAuth } from './auth.js';

export interface ActivateTokenResponse {
  apiToken: string;
}

/**
 * TxLINEActivation manages the API token lifecycle.
 *
 * Usage:
 *   const auth = new TxLINEAuth();
 *   await auth.acquireGuestJWT();
 *   const activation = new TxLINEActivation(auth);
 *   await activation.activateAPIToken(txSig);
 *   const headers = activation.getAuthHeaders();
 */
export class TxLINEActivation {
  private apiToken: string | null = null;
  private auth: TxLINEAuth;

  constructor(auth: TxLINEAuth) {
    this.auth = auth;
  }

  /**
   * Loads the service wallet keypair from the environment config.
   * The keypair is stored as a JSON array of bytes in TXLINE_WALLET_KEYPAIR.
   */
  private loadKeypair(): Keypair {
    const { txlineWalletKeypair } = getEnvConfig();

    if (!txlineWalletKeypair) {
      throw new Error(
        '[TxLINEActivation] TXLINE_WALLET_KEYPAIR environment variable is not set.'
      );
    }

    try {
      const secretKey = new Uint8Array(JSON.parse(txlineWalletKeypair));
      return Keypair.fromSecretKey(secretKey);
    } catch (err) {
      throw new Error(
        `[TxLINEActivation] Failed to parse TXLINE_WALLET_KEYPAIR: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Signs a message string using the service wallet's Ed25519 private key.
   * Uses @noble/curves ed25519 which expects the 32-byte private seed.
   * Solana's Keypair.secretKey is 64 bytes: [32-byte seed | 32-byte pubkey].
   *
   * @param message The string message to sign.
   * @returns Base64-encoded 64-byte Ed25519 signature.
   */
  private signMessage(message: string): string {
    const keypair = this.loadKeypair();
    const messageBytes = new TextEncoder().encode(message);

    // Extract 32-byte private seed from 64-byte Solana secretKey
    const privateKey = keypair.secretKey.slice(0, 32);
    const signature = ed25519.sign(messageBytes, privateKey);

    return Buffer.from(signature).toString('base64');
  }

  /**
   * Activates an API token by signing the activation message and POSTing to TxLINE.
   *
   * The activation message format is: `${txSig}::${jwt}`
   * (two colons separator; leagues array is empty so no league suffix)
   *
   * @param txSig The on-chain subscription transaction signature.
   * @returns The API token string.
   * @throws If JWT is not available, signing fails, or the API request fails.
   */
  async activateAPIToken(txSig: string): Promise<string> {
    const jwt = this.auth.getJWT();
    const message = `${txSig}::${jwt}`;
    const walletSignature = this.signMessage(message);

    const { txlineApiBaseUrl } = getEnvConfig();
    const url = `${txlineApiBaseUrl}/api/token/activate`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        transactionSignature: txSig,
        walletSignature,
        leagues: [],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `[TxLINEActivation] Failed to activate API token: ${response.status} ${response.statusText}` +
          (body ? ` — ${body}` : '')
      );
    }

    const data = (await response.json()) as ActivateTokenResponse;

    if (!data.apiToken || typeof data.apiToken !== 'string') {
      throw new Error(
        '[TxLINEActivation] Malformed response from /api/token/activate: missing apiToken'
      );
    }

    this.apiToken = data.apiToken;
    return data.apiToken;
  }

  /**
   * Returns the stored API token.
   *
   * @throws If no API token has been activated.
   */
  getAPIToken(): string {
    if (!this.apiToken) {
      throw new Error(
        '[TxLINEActivation] No API token activated. Call activateAPIToken() first.'
      );
    }
    return this.apiToken;
  }

  /**
   * Returns both authentication headers required for TxLINE data endpoints.
   *
   * @returns Object with `Authorization` (Bearer JWT) and `X-Api-Token` headers.
   * @throws If JWT or API token is not available.
   */
  getAuthHeaders(): { Authorization: string; 'X-Api-Token': string } {
    const jwt = this.auth.getJWT();
    const apiToken = this.getAPIToken();

    return {
      Authorization: `Bearer ${jwt}`,
      'X-Api-Token': apiToken,
    };
  }

  /**
   * Checks whether an API token has been activated and is stored in memory.
   */
  hasAPIToken(): boolean {
    return this.apiToken !== null;
  }

  /**
   * Clears the stored API token. Useful for re-activation flows or testing.
   */
  clear(): void {
    this.apiToken = null;
  }
}

/**
 * Centralized environment variable validation.
 * Ensures required variables are present with helpful error messages.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[TRIBE] Missing required environment variable: ${name}. ` +
        `Check your .env file or deployment configuration.`
    );
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export interface EnvConfig {
  // Supabase
  supabaseUrl: string;
  supabaseServiceRoleKey: string;

  // Solana
  solanaRpcUrl: string;
  solanaNetwork: string;
  anchorProgramId: string;

  // TxLINE
  txlineApiBaseUrl: string;
  txlineWalletKeypair: string;

  // Server
  port: number;
}

let _config: EnvConfig | null = null;

/**
 * Validates and returns the application environment configuration.
 * Throws descriptive errors if required variables are missing.
 * Caches the result after first successful validation.
 */
export function getEnvConfig(): EnvConfig {
  if (_config) return _config;

  _config = {
    // Supabase (required for all database operations)
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),

    // Solana
    solanaRpcUrl: optionalEnv('SOLANA_RPC_URL', 'https://api.devnet.solana.com'),
    solanaNetwork: optionalEnv('SOLANA_NETWORK', 'devnet'),
    anchorProgramId: optionalEnv('ANCHOR_PROGRAM_ID', ''),

    // TxLINE
    txlineApiBaseUrl: optionalEnv('TXLINE_API_BASE_URL', 'https://txline-dev.txodds.com/api'),
    txlineWalletKeypair: optionalEnv('TXLINE_WALLET_KEYPAIR', ''),

    // Server
    port: parseInt(optionalEnv('PORT', '3001'), 10),
  };

  return _config;
}

/**
 * Resets the cached config. Useful for testing.
 */
export function resetEnvConfig(): void {
  _config = null;
}

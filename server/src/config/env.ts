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
  // Supabase (optional — server starts without it, just skips DB ops)
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseAvailable: boolean;

  // Solana
  solanaRpcUrl: string;
  solanaNetwork: string;
  anchorProgramId: string;

  // TxLINE
  txlineApiBaseUrl: string;
  txlineApiToken: string;
  txlineWalletKeypair: string;

  // AI
  anthropicApiKey: string;

  // Server
  port: number;
}

let _config: EnvConfig | null = null;

/**
 * Validates and returns the application environment configuration.
 * Supabase is optional — the server starts without it (skips DB operations).
 * Caches the result after first successful validation.
 */
export function getEnvConfig(): EnvConfig {
  if (_config) return _config;

  const supabaseUrl = optionalEnv('SUPABASE_URL', '');
  const supabaseServiceRoleKey = optionalEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  const supabaseAvailable = !!(
    supabaseUrl &&
    supabaseServiceRoleKey &&
    !supabaseUrl.includes('placeholder') &&
    !supabaseServiceRoleKey.includes('placeholder')
  );

  _config = {
    // Supabase (optional)
    supabaseUrl,
    supabaseServiceRoleKey,
    supabaseAvailable,

    // Solana
    solanaRpcUrl: optionalEnv('SOLANA_RPC_URL', 'https://api.devnet.solana.com'),
    solanaNetwork: optionalEnv('SOLANA_NETWORK', 'devnet'),
    anchorProgramId: optionalEnv('ANCHOR_PROGRAM_ID', ''),

    // TxLINE
    txlineApiBaseUrl: optionalEnv('TXLINE_API_BASE_URL', 'https://txline-dev.txodds.com/api'),
    txlineApiToken: optionalEnv('TXLINE_API_TOKEN', ''),
    txlineWalletKeypair: optionalEnv('TXLINE_WALLET_KEYPAIR', ''),

    // AI
    anthropicApiKey: optionalEnv('ANTHROPIC_API_KEY', ''),

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

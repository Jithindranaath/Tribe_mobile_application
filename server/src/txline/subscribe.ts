/**
 * TxLINE On-Chain Subscription Module.
 *
 * Executes the on-chain `subscribe` instruction on the TxLINE Anchor program
 * to obtain a valid subscription. The returned transaction signature is then
 * used by the activation module to obtain an API token.
 *
 * Flow:
 *   1. Load service wallet keypair from env
 *   2. Connect to the appropriate Solana cluster (devnet/mainnet)
 *   3. Call TxLINE program's `subscribe` instruction with:
 *      - serviceLevel: 1 (devnet, 60s delay) or 12 (mainnet, real-time)
 *      - weeks: 4
 *      - selectedLeagues: [] (empty for all coverage)
 *   4. Return the transaction signature for activation
 *
 * TxLINE Program IDs:
 *   - Devnet:  6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
 *   - Mainnet: 9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { getEnvConfig } from '../config/env.js';

/** TxLINE program addresses per network */
const TXLINE_PROGRAM_IDS = {
  devnet: '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J',
  mainnet: '9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA',
} as const;

/** Default subscription parameters */
const DEFAULT_WEEKS = 4;
const DEFAULT_SELECTED_LEAGUES: number[] = [];

export interface SubscribeOptions {
  /** Service level: 1 for devnet (60s delay), 12 for mainnet (real-time) */
  serviceLevel?: number;
  /** Subscription duration in weeks (default: 4) */
  weeks?: number;
  /** League IDs to subscribe to (empty = all coverage) */
  selectedLeagues?: number[];
}

export interface SubscribeResult {
  /** The on-chain transaction signature */
  transactionSignature: string;
  /** The TxLINE program ID used */
  programId: string;
  /** The network used (devnet or mainnet) */
  network: string;
}

/**
 * Loads the service wallet keypair from the TXLINE_WALLET_KEYPAIR env variable.
 * The keypair is stored as a JSON array of 64 bytes.
 */
function loadServiceWallet(): Keypair {
  const { txlineWalletKeypair } = getEnvConfig();

  if (!txlineWalletKeypair) {
    throw new Error(
      '[TxLINESubscribe] TXLINE_WALLET_KEYPAIR environment variable is not set. ' +
        'Run: npx tsx server/scripts/generate-wallet.ts --airdrop'
    );
  }

  try {
    const secretKey = new Uint8Array(JSON.parse(txlineWalletKeypair));
    return Keypair.fromSecretKey(secretKey);
  } catch (err) {
    throw new Error(
      `[TxLINESubscribe] Failed to parse TXLINE_WALLET_KEYPAIR: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Resolves the TxLINE program ID and default service level based on the
 * configured Solana network.
 */
function resolveNetwork(): { programId: string; defaultServiceLevel: number; network: string } {
  const { solanaNetwork } = getEnvConfig();
  const isMainnet = solanaNetwork === 'mainnet' || solanaNetwork === 'mainnet-beta';

  return {
    programId: isMainnet ? TXLINE_PROGRAM_IDS.mainnet : TXLINE_PROGRAM_IDS.devnet,
    defaultServiceLevel: isMainnet ? 12 : 1,
    network: isMainnet ? 'mainnet' : 'devnet',
  };
}

/**
 * Encodes the `subscribe` instruction data for the TxLINE Anchor program.
 *
 * The instruction expects:
 *   - 8 bytes: Anchor instruction discriminator (sha256("global:subscribe")[0..8])
 *   - 1 byte:  serviceLevel (u8)
 *   - 4 bytes: weeks (u32, little-endian)
 *   - 4 bytes: selectedLeagues vec length (u32, little-endian)
 *   - N * 4 bytes: each league ID (u32, little-endian)
 *
 * Note: The Anchor discriminator for "subscribe" is computed as the first 8 bytes
 * of sha256("global:subscribe"). We pre-compute this value.
 */
function encodeSubscribeInstruction(
  serviceLevel: number,
  weeks: number,
  selectedLeagues: number[]
): Buffer {
  // Anchor discriminator for "subscribe" instruction
  // sha256("global:subscribe") first 8 bytes
  // Pre-computed: [0xc5, 0x3a, 0x99, 0x0c, 0x60, 0x73, 0xd7, 0x1d]
  const discriminator = Buffer.from([0xc5, 0x3a, 0x99, 0x0c, 0x60, 0x73, 0xd7, 0x1d]);

  // serviceLevel: u8
  const serviceLevelBuf = Buffer.alloc(1);
  serviceLevelBuf.writeUInt8(serviceLevel);

  // weeks: u32 LE
  const weeksBuf = Buffer.alloc(4);
  weeksBuf.writeUInt32LE(weeks);

  // selectedLeagues: Vec<u32> encoded as [length: u32, ...items: u32[]]
  const leaguesLenBuf = Buffer.alloc(4);
  leaguesLenBuf.writeUInt32LE(selectedLeagues.length);

  const leagueItemsBuf = Buffer.alloc(selectedLeagues.length * 4);
  selectedLeagues.forEach((leagueId, idx) => {
    leagueItemsBuf.writeUInt32LE(leagueId, idx * 4);
  });

  return Buffer.concat([
    discriminator,
    serviceLevelBuf,
    weeksBuf,
    leaguesLenBuf,
    leagueItemsBuf,
  ]);
}

/**
 * Subscribes to TxLINE by executing the on-chain `subscribe` instruction.
 *
 * This sends a Solana transaction to the TxLINE program with the specified
 * service level and subscription parameters. The returned transaction signature
 * is used by TxLINEActivation.activateAPIToken() to complete the auth flow.
 *
 * @param options - Optional overrides for service level, weeks, and leagues.
 * @returns The transaction signature and metadata.
 *
 * @example
 * ```typescript
 * import { subscribeTxLINE } from './subscribe.js';
 *
 * // Use defaults based on SOLANA_NETWORK env variable
 * const result = await subscribeTxLINE();
 * console.log('Tx signature:', result.transactionSignature);
 *
 * // Explicit mainnet subscription
 * const mainnetResult = await subscribeTxLINE({ serviceLevel: 12, weeks: 4 });
 * ```
 */
export async function subscribeTxLINE(options: SubscribeOptions = {}): Promise<SubscribeResult> {
  const { solanaRpcUrl } = getEnvConfig();
  const { programId, defaultServiceLevel, network } = resolveNetwork();

  const serviceLevel = options.serviceLevel ?? defaultServiceLevel;
  const weeks = options.weeks ?? DEFAULT_WEEKS;
  const selectedLeagues = options.selectedLeagues ?? DEFAULT_SELECTED_LEAGUES;

  // Load service wallet
  const serviceWallet = loadServiceWallet();

  console.log('[TxLINESubscribe] Subscribing to TxLINE...');
  console.log(`  Network:       ${network}`);
  console.log(`  Program ID:    ${programId}`);
  console.log(`  Service Level: ${serviceLevel}`);
  console.log(`  Weeks:         ${weeks}`);
  console.log(`  Leagues:       ${selectedLeagues.length === 0 ? '[] (all)' : JSON.stringify(selectedLeagues)}`);
  console.log(`  Wallet:        ${serviceWallet.publicKey.toBase58()}`);

  // Establish connection
  const connection = new Connection(solanaRpcUrl, 'confirmed');

  // Encode instruction data
  const instructionData = encodeSubscribeInstruction(serviceLevel, weeks, selectedLeagues);

  // Build the transaction instruction
  const txlineProgramId = new PublicKey(programId);
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: serviceWallet.publicKey, isSigner: true, isWritable: true },
    ],
    programId: txlineProgramId,
    data: instructionData,
  });

  // Build and send transaction
  const transaction = new Transaction().add(instruction);

  const transactionSignature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [serviceWallet],
    { commitment: 'confirmed' }
  );

  console.log(`[TxLINESubscribe] ✔ Subscription successful!`);
  console.log(`  Transaction: ${transactionSignature}`);

  return {
    transactionSignature,
    programId,
    network,
  };
}

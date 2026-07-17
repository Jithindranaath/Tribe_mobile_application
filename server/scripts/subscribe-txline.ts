#!/usr/bin/env npx tsx
/**
 * TxLINE Subscription Script
 *
 * Executes the full TxLINE authentication flow:
 *   1. Get guest JWT from /auth/guest/start
 *   2. Subscribe on-chain (devnet SL 1 or mainnet SL 12)
 *   3. Sign activation message
 *   4. Activate API token via /api/token/activate
 *   5. Test the connection by fetching fixtures
 *
 * After running, the API token is printed for your .env file.
 *
 * Usage:
 *   npx tsx scripts/subscribe-txline.ts
 *   npx tsx scripts/subscribe-txline.ts --mainnet  (for real-time demo)
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';

// Load env from root
config({ path: resolve(import.meta.dirname, '../../.env') });

// ─── Config ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isMainnet = args.includes('--mainnet');

const NETWORK = isMainnet ? 'mainnet' : 'devnet';
const RPC_URL = isMainnet
  ? 'https://api.mainnet-beta.solana.com'
  : (process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com');
const API_BASE = isMainnet
  ? 'https://txline.txodds.com/api'
  : (process.env.TXLINE_API_BASE_URL || 'https://txline-dev.txodds.com/api');
const TXLINE_PROGRAM_ID = isMainnet
  ? '9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA'
  : '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J';
const SERVICE_LEVEL = isMainnet ? 12 : 1;
const WEEKS = 4;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadKeypair(): Keypair {
  const raw = process.env.TXLINE_WALLET_KEYPAIR;
  if (!raw) {
    console.error('❌ TXLINE_WALLET_KEYPAIR not set in .env');
    console.error('   Run: npx tsx scripts/generate-wallet.ts --airdrop');
    process.exit(1);
  }
  try {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  } catch {
    console.error('❌ Failed to parse TXLINE_WALLET_KEYPAIR');
    process.exit(1);
  }
}

function signMessage(keypair: Keypair, message: string): string {
  const messageBytes = new TextEncoder().encode(message);
  const privateKey = keypair.secretKey.slice(0, 32);
  const signature = ed25519.sign(messageBytes, privateKey);
  return Buffer.from(signature).toString('base64');
}

// ─── Main Flow ───────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  TxLINE Subscription Flow');
  console.log('══════════════════════════════════════════════════════════\n');
  console.log(`  Network:       ${NETWORK}`);
  console.log(`  RPC:           ${RPC_URL}`);
  console.log(`  API Base:      ${API_BASE}`);
  console.log(`  Program ID:    ${TXLINE_PROGRAM_ID}`);
  console.log(`  Service Level: ${SERVICE_LEVEL}`);
  console.log('');

  const keypair = loadKeypair();
  console.log(`  Wallet:        ${keypair.publicKey.toBase58()}\n`);

  // ─── Step 1: Get Guest JWT ─────────────────────────────────────────────

  console.log('  [Step 1] Getting guest JWT...');
  const jwtResponse = await fetch(`${API_BASE.replace('/api', '')}/auth/guest/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!jwtResponse.ok) {
    const body = await jwtResponse.text();
    console.error(`  ❌ Failed: ${jwtResponse.status} ${jwtResponse.statusText}`);
    console.error(`     ${body}`);
    process.exit(1);
  }

  const jwtData = await jwtResponse.json() as { token: string };
  const jwt = jwtData.token;
  console.log(`  ✔ JWT acquired\n`);

  // ─── Step 2: On-chain Subscribe ────────────────────────────────────────

  console.log('  [Step 2] Subscribing on-chain...');
  const connection = new Connection(RPC_URL, 'confirmed');

  // Check balance
  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`  Balance: ${balance / 1e9} SOL`);
  if (balance < 5000) {
    console.error('  ❌ Insufficient SOL for transaction fees');
    console.error('     Go to https://faucet.solana.com');
    console.error('     Paste: ' + keypair.publicKey.toBase58());
    console.error('     Select Devnet, get airdrop, then re-run this script.');
    process.exit(1);
  }

  // Derive required PDAs for subscribe instruction
  const programId = new PublicKey(TXLINE_PROGRAM_ID);
  const TXL_TOKEN_MINT = isMainnet
    ? new PublicKey('Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL')
    : new PublicKey('4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG');

  const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_treasury_v2')],
    programId
  );

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pricing_matrix')],
    programId
  );

  // User's associated token account for TxL (Token-2022)
  const userTokenAccount = PublicKey.findProgramAddressSync(
    [
      keypair.publicKey.toBuffer(),
      TOKEN_2022_PROGRAM_ID.toBuffer(),
      TXL_TOKEN_MINT.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];

  // Treasury vault (ATA of treasury PDA)
  const tokenTreasuryVault = PublicKey.findProgramAddressSync(
    [
      tokenTreasuryPda.toBuffer(),
      TOKEN_2022_PROGRAM_ID.toBuffer(),
      TXL_TOKEN_MINT.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];

  // Build subscribe instruction using Anchor discriminator
  // Anchor discriminator for "subscribe": sha256("global:subscribe")[0..8]
  const discriminator = Buffer.from([0xc5, 0x3a, 0x99, 0x0c, 0x60, 0x73, 0xd7, 0x1d]);
  const serviceLevelBuf = Buffer.alloc(1);
  serviceLevelBuf.writeUInt8(SERVICE_LEVEL);
  const weeksBuf = Buffer.alloc(4);
  weeksBuf.writeUInt32LE(WEEKS);

  const instructionData = Buffer.concat([discriminator, serviceLevelBuf, weeksBuf]);

  // Accounts for the subscribe instruction
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: pricingMatrixPda, isSigner: false, isWritable: false },
      { pubkey: TXL_TOKEN_MINT, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: tokenTreasuryVault, isSigner: false, isWritable: true },
      { pubkey: tokenTreasuryPda, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false }, // System Program
    ],
    programId,
    data: instructionData,
  });

  const transaction = new Transaction().add(instruction);

  let txSig: string;
  try {
    txSig = await sendAndConfirmTransaction(connection, transaction, [keypair], {
      commitment: 'confirmed',
    });
    console.log(`  ✔ Subscribe tx confirmed: ${txSig}\n`);
  } catch (err: any) {
    console.error(`  ❌ Transaction failed: ${err.message}`);
    console.error('');
    console.error('  Common causes:');
    console.error('  - Insufficient SOL: get airdrop at https://faucet.solana.com');
    console.error('  - Account not initialized: the free tier may still need an ATA');
    console.error('  - Wrong accounts: check TxLINE docs for exact account layout');
    console.error('');
    console.error('  Full error:', err.logs || err.message);
    process.exit(1);
  }

  // ─── Step 3: Sign Activation Message ───────────────────────────────────

  console.log('  [Step 3] Signing activation message...');
  // Message format from docs: ${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}
  // With empty leagues: ${txSig}::${jwt}
  const activationMessage = `${txSig}::${jwt}`;
  const walletSignature = signMessage(keypair, activationMessage);
  console.log(`  ✔ Message signed\n`);

  // ─── Step 4: Activate API Token ────────────────────────────────────────

  console.log('  [Step 4] Activating API token...');
  const API_ORIGIN = API_BASE.replace('/api', '');
  const activateResponse = await fetch(`${API_BASE}/token/activate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      txSig,
      walletSignature,
      leagues: [],
    }),
  });

  if (!activateResponse.ok) {
    const body = await activateResponse.text();
    console.error(`  ❌ Activation failed: ${activateResponse.status} ${activateResponse.statusText}`);
    console.error(`     ${body}`);
    process.exit(1);
  }

  const activateData = await activateResponse.json() as any;
  const apiToken = activateData.token || activateData.apiToken || activateData;
  console.log(`  ✔ API token activated!\n`);

  // ─── Step 5: Test Connection ───────────────────────────────────────────

  console.log('  [Step 5] Testing connection (fetching fixtures)...');
  const testResponse = await fetch(`${API_BASE}/api/fixtures`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      'X-Api-Token': apiToken,
    },
  });

  if (testResponse.ok) {
    const fixtures = await testResponse.json();
    const count = Array.isArray(fixtures) ? fixtures.length : 'unknown';
    console.log(`  ✔ Connection successful! Found ${count} fixtures.\n`);
  } else {
    console.warn(`  ⚠ Fixtures endpoint returned ${testResponse.status} — token may still work for streams.\n`);
  }

  // ─── Done ──────────────────────────────────────────────────────────────

  console.log('══════════════════════════════════════════════════════════');
  console.log('  ✅ TxLINE SUBSCRIPTION COMPLETE');
  console.log('══════════════════════════════════════════════════════════\n');
  console.log('  Add these to your .env file:\n');
  console.log(`  TXLINE_GUEST_JWT=${jwt}`);
  console.log(`  TXLINE_API_TOKEN=${apiToken}`);
  console.log(`  TXLINE_TX_SIGNATURE=${txSig}`);
  console.log('');
  console.log('  Note: The JWT expires in ~1 hour. The server\'s refresh loop');
  console.log('  handles this automatically when running. The API token persists.');
  console.log('');
  console.log('  To use mainnet (real-time, for demo recording):');
  console.log('    npx tsx scripts/subscribe-txline.ts --mainnet');
  console.log('');
  console.log('══════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

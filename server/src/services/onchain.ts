/**
 * On-chain client for the TRIBE Anchor program (FanAccount / TribeAccount).
 *
 * The service wallet (TXLINE_WALLET_KEYPAIR — the same funded devnet wallet
 * already used for the TxLINE subscription flow) acts as the transaction
 * payer for account creation. `CreateFanAccount.authority` is intentionally
 * NOT a required signer on-chain (see program/programs/tribe/src/lib.rs) —
 * the fan's embedded wallet pubkey is just recorded as a reference, since the
 * silent-wallet architecture means the server never holds the fan's key.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, default as anchorPkg } from '@coral-xyz/anchor';

// `BN` is not part of @coral-xyz/anchor's named ESM exports (only its CJS
// default export) — under Node's native ESM loader (unlike bundler-style
// transforms such as Vite's, which synthesize CJS named exports), a named
// `import { BN }` throws at import time. Pull it off the default export instead.
const { BN } = anchorPkg;
import { getEnvConfig } from '../config/env.js';
import type { Tribe } from '../idl/tribe.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const idl = JSON.parse(readFileSync(path.join(__dirname, '../idl/tribe.json'), 'utf-8')) as Tribe;

// ─── Deterministic tribeId -> numeric id derivation ───────────────────────────
//
// The client sends string slugs (e.g. tribeId "brazil-brazil-hyderabad",
// macroTribe "Brazil") but the on-chain TribeAccount PDA needs numeric
// macro_id (u16) / region_id (u32). FNV-1a gives a stable, collision-resistant
// mapping without needing a hardcoded country-code table. macro_id is derived
// from the macro tribe name alone so all sub-tribes of the same country share
// one macro_id (needed for within-country ranking/filtering).

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0; // unsigned 32-bit
}

export function deriveMacroId(macroTribeName: string): number {
  return fnv1a(macroTribeName.toLowerCase()) % 65536; // u16 range
}

export function deriveRegionId(tribeId: string): number {
  return fnv1a(tribeId.toLowerCase()); // already unsigned 32-bit
}

// ─── Service wallet + Anchor Program singletons ───────────────────────────────

let _serviceWallet: Keypair | null = null;
let _program: Program<Tribe> | null = null;

function loadServiceWallet(): Keypair {
  if (_serviceWallet) return _serviceWallet;

  const { txlineWalletKeypair } = getEnvConfig();
  if (!txlineWalletKeypair) {
    throw new Error(
      '[onchain] TXLINE_WALLET_KEYPAIR is not set — cannot sign on-chain transactions.',
    );
  }

  const secretKey = new Uint8Array(JSON.parse(txlineWalletKeypair));
  _serviceWallet = Keypair.fromSecretKey(secretKey);
  return _serviceWallet;
}

function getProgram(): Program<Tribe> {
  if (_program) return _program;

  const { solanaRpcUrl } = getEnvConfig();
  const wallet = loadServiceWallet();
  const connection = new Connection(solanaRpcUrl, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(wallet), {
    commitment: 'confirmed',
  });

  _program = new Program(idl, provider);
  return _program;
}

/** Resets cached singletons. Useful for testing. */
export function resetOnchainClient(): void {
  _serviceWallet = null;
  _program = null;
}

// ─── PDA Derivation ────────────────────────────────────────────────────────────

export function deriveTribePda(macroId: number, regionId: number): PublicKey {
  const macroBuf = Buffer.alloc(2);
  macroBuf.writeUInt16LE(macroId);
  const regionBuf = Buffer.alloc(4);
  regionBuf.writeUInt32LE(regionId);

  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('tribe'), macroBuf, regionBuf],
    getProgram().programId,
  );
  return pda;
}

export function deriveFanPda(authority: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('fan'), authority.toBuffer()],
    getProgram().programId,
  );
  return pda;
}

/**
 * reads_live has no numeric sequence — only a UUID read_id — but the
 * ReadRecord PDA seed needs a u64 read_seq. Deriving one deterministically
 * from a hash of read_id gives a stable, collision-free 1:1 mapping without
 * needing new state (e.g. a per-fan-per-fixture counter).
 */
export function deriveReadSeq(readId: string): bigint {
  const hash = createHash('sha256').update(readId).digest();
  return hash.readBigUInt64BE(0);
}

export function deriveReadPda(fanPda: PublicKey, fixtureId: bigint, readSeq: bigint): PublicKey {
  const fixtureBuf = Buffer.alloc(8);
  fixtureBuf.writeBigUInt64LE(fixtureId);
  const seqBuf = Buffer.alloc(8);
  seqBuf.writeBigUInt64LE(readSeq);

  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('read'), fanPda.toBuffer(), fixtureBuf, seqBuf],
    getProgram().programId,
  );
  return pda;
}

// ─── Get-or-create: TribeAccount ──────────────────────────────────────────────

export interface TribeIdentity {
  macroId: number;
  regionId: number;
  pda: PublicKey;
  aggregateStanding: number;
  memberCount: number;
}

/**
 * Fetches the on-chain TribeAccount for the given tribeId, creating it
 * (via `create_tribe`, paid by the service wallet) if it doesn't exist yet.
 */
export async function getOrCreateTribeAccount(
  tribeId: string,
  macroTribeName: string,
): Promise<TribeIdentity> {
  const program = getProgram();
  const wallet = loadServiceWallet();

  const macroId = deriveMacroId(macroTribeName);
  const regionId = deriveRegionId(tribeId);
  const pda = deriveTribePda(macroId, regionId);

  const existing = await program.account.tribeAccount.fetchNullable(pda);
  if (existing) {
    return {
      macroId,
      regionId,
      pda,
      aggregateStanding: Number(existing.aggregateStanding),
      memberCount: existing.memberCount,
    };
  }

  // tribeAccount (PDA) and systemProgram (fixed address) are auto-resolved by
  // Anchor from the IDL — only admin needs to be supplied explicitly.
  await program.methods
    .createTribe(macroId, regionId)
    .accounts({
      admin: wallet.publicKey,
    })
    .signers([wallet])
    .rpc();

  return { macroId, regionId, pda, aggregateStanding: 0, memberCount: 0 };
}

// ─── Get-or-create: FanAccount ─────────────────────────────────────────────────

export interface FanIdentity {
  pda: PublicKey;
  standing: number;
  titles: number;
  readsCorrect: number;
  readsTotal: number;
  isNew: boolean;
}

/**
 * Fetches the on-chain FanAccount for the given wallet address, creating it
 * (via `create_fan_account`, paid by the service wallet) if it doesn't exist
 * yet. The fan's wallet does not need to sign — see module docstring.
 */
export async function getOrCreateFanAccount(
  walletAddress: string,
  tribePda: PublicKey,
): Promise<FanIdentity> {
  const program = getProgram();
  const wallet = loadServiceWallet();
  const authority = new PublicKey(walletAddress);
  const fanPda = deriveFanPda(authority);

  const existing = await program.account.fanAccount.fetchNullable(fanPda);
  if (existing) {
    return {
      pda: fanPda,
      standing: Number(existing.standing),
      titles: existing.titles,
      readsCorrect: existing.readsCorrect,
      readsTotal: existing.readsTotal,
      isNew: false,
    };
  }

  // fanAccount (PDA) and systemProgram (fixed address) are auto-resolved by
  // Anchor from the IDL.
  await program.methods
    .createFanAccount()
    .accounts({
      tribe: tribePda,
      authority,
      payer: wallet.publicKey,
    })
    .signers([wallet])
    .rpc();

  return { pda: fanPda, standing: 100, titles: 0, readsCorrect: 0, readsTotal: 0, isNew: true };
}

// ─── Settlement: settle_read ───────────────────────────────────────────────────

const READ_TYPE_CODES: Record<string, number> = {
  moment_read: 0,
  momentum_read: 1,
  instinct_read: 2,
};

function encodeReadType(readType: string): number {
  return READ_TYPE_CODES[readType] ?? 0;
}

export interface SettleReadInput {
  walletAddress: string;
  tribePda: PublicKey;
  fixtureId: string;
  readId: string;
  readType: string;
  predicted: number;
  resolved: number;
  txLineSeq: number;
  correct: boolean;
  standingDelta: number;
  /** Priority fee for this attempt (retries use an increasing value). */
  priorityFeeMicroLamports?: number;
}

/**
 * Settles a resolved Read on-chain: creates the ReadRecord PDA and updates
 * both FanAccount.standing and TribeAccount.aggregate_standing. Paid and
 * signed by the service wallet — the fan's wallet is never involved.
 */
export async function settleReadOnChain(input: SettleReadInput): Promise<{ txSignature: string }> {
  const program = getProgram();
  const wallet = loadServiceWallet();
  const authority = new PublicKey(input.walletAddress);
  const fanPda = deriveFanPda(authority);
  const fixtureIdBig = BigInt(input.fixtureId);
  const readSeq = deriveReadSeq(input.readId);

  const preInstructions = input.priorityFeeMicroLamports
    ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: input.priorityFeeMicroLamports })]
    : [];

  // readRecord (PDA, seeded from fixtureId + readSeq) and systemProgram are
  // auto-resolved by Anchor from the IDL.
  const txSignature = await program.methods
    .settleRead(
      new BN(fixtureIdBig.toString()),
      new BN(readSeq.toString()),
      encodeReadType(input.readType),
      input.predicted,
      input.resolved,
      new BN(input.txLineSeq),
      input.correct,
      new BN(input.standingDelta),
    )
    .accounts({
      fanAccount: fanPda,
      tribe: input.tribePda,
      settler: wallet.publicKey,
    })
    .preInstructions(preInstructions)
    .signers([wallet])
    .rpc();

  return { txSignature };
}

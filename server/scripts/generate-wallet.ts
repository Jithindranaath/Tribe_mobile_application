#!/usr/bin/env npx tsx
/**
 * generate-wallet.ts
 *
 * One-time setup script to generate a Solana keypair for the TRIBE backend service.
 * The keypair is used by the TxLINE Adapter to sign subscription activation messages.
 *
 * Usage:
 *   npx tsx server/scripts/generate-wallet.ts            # Generate keypair only
 *   npx tsx server/scripts/generate-wallet.ts --airdrop  # Generate + airdrop 2 SOL on devnet
 *
 * Output:
 *   - Public key (for reference and on-chain subscription)
 *   - Secret key as JSON byte array (paste into TXLINE_WALLET_KEYPAIR env var)
 *
 * Security:
 *   - NEVER commit the secret key to source control
 *   - Store it only in .env (which is .gitignored)
 *   - For production (mainnet), fund the wallet with real SOL
 */

import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shouldAirdrop = args.includes('--airdrop');

  // Generate a new random keypair
  const keypair = Keypair.generate();

  const publicKey = keypair.publicKey.toBase58();
  const secretKeyArray = JSON.stringify(Array.from(keypair.secretKey));

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  TRIBE Service Wallet Generator');
  console.log('══════════════════════════════════════════════════════════════\n');

  console.log('✔ New Solana keypair generated\n');

  console.log('  Public Key:');
  console.log(`  ${publicKey}\n`);

  console.log('  Secret Key (JSON byte array):');
  console.log(`  ${secretKeyArray}\n`);

  console.log('──────────────────────────────────────────────────────────────');
  console.log('  HOW TO USE');
  console.log('──────────────────────────────────────────────────────────────\n');
  console.log('  1. Copy the secret key array above');
  console.log('  2. Open your .env file (create from .env.example if needed)');
  console.log('  3. Set the variable:\n');
  console.log(`     TXLINE_WALLET_KEYPAIR=${secretKeyArray}\n`);
  console.log('  4. The activation module will load this keypair to sign');
  console.log('     TxLINE subscription messages.\n');
  console.log('  ⚠  NEVER commit this key to source control!\n');

  // Airdrop devnet SOL if requested
  if (shouldAirdrop) {
    console.log('──────────────────────────────────────────────────────────────');
    console.log('  DEVNET AIRDROP');
    console.log('──────────────────────────────────────────────────────────────\n');

    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    console.log(`  Requesting 2 SOL airdrop on devnet...`);
    console.log(`  RPC: ${rpcUrl}\n`);

    try {
      const signature = await connection.requestAirdrop(
        keypair.publicKey,
        2 * LAMPORTS_PER_SOL
      );

      console.log(`  Airdrop requested. Signature:`);
      console.log(`  ${signature}\n`);

      console.log('  Confirming transaction...');
      await connection.confirmTransaction(signature, 'confirmed');

      const balance = await connection.getBalance(keypair.publicKey);
      console.log(`  ✔ Airdrop confirmed! Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);
    } catch (err) {
      console.error('  ✘ Airdrop failed:', err instanceof Error ? err.message : String(err));
      console.error('    This is common on devnet due to rate limits.');
      console.error('    You can manually airdrop via: solana airdrop 2 ' + publicKey + ' --url devnet\n');
    }
  } else {
    console.log('  Tip: Run with --airdrop to fund this wallet with 2 devnet SOL:');
    console.log('    npx tsx server/scripts/generate-wallet.ts --airdrop\n');
  }

  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

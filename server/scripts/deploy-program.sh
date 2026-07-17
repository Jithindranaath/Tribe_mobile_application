#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
#  TRIBE Anchor Program — Build & Deploy to Solana Devnet
# ══════════════════════════════════════════════════════════════
#
# This script builds the Anchor program and deploys it to devnet.
# After deployment, update the ANCHOR_PROGRAM_ID in your .env file.
#
# Prerequisites:
#   - Anchor CLI installed (v0.30+)
#   - Solana CLI installed and configured for devnet
#   - Wallet funded with devnet SOL (use: solana airdrop 2)
#
# Usage:
#   chmod +x server/scripts/deploy-program.sh
#   ./server/scripts/deploy-program.sh
#
# ══════════════════════════════════════════════════════════════

set -e

# Navigate to program directory (Anchor workspace root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROGRAM_DIR="$(cd "$SCRIPT_DIR/../../program" && pwd)"

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  TRIBE Anchor Program — Build & Deploy"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "  Program directory: $PROGRAM_DIR"
echo ""

cd "$PROGRAM_DIR"

# Step 1: Build the program
echo "──────────────────────────────────────────────────────────────"
echo "  Step 1: Building Anchor program..."
echo "──────────────────────────────────────────────────────────────"
echo ""

anchor build

echo ""
echo "  ✔ Build successful"
echo ""

# Step 2: Extract the program ID from the build keypair
# Anchor generates a keypair at target/deploy/tribe-keypair.json
KEYPAIR_PATH="$PROGRAM_DIR/target/deploy/tribe-keypair.json"

if [ ! -f "$KEYPAIR_PATH" ]; then
  echo "  ✘ Error: Keypair not found at $KEYPAIR_PATH"
  echo "    Run 'anchor build' first or check program name in Anchor.toml"
  exit 1
fi

PROGRAM_ID=$(solana-keygen pubkey "$KEYPAIR_PATH")
echo "  Program ID (from build keypair): $PROGRAM_ID"
echo ""

# Step 3: Deploy to devnet
echo "──────────────────────────────────────────────────────────────"
echo "  Step 2: Deploying to Solana devnet..."
echo "──────────────────────────────────────────────────────────────"
echo ""

anchor deploy --provider.cluster devnet

echo ""
echo "  ✔ Deployment successful!"
echo ""

# Step 4: Output configuration instructions
echo "══════════════════════════════════════════════════════════════"
echo "  DEPLOYMENT COMPLETE"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "  Program ID: $PROGRAM_ID"
echo ""
echo "  ────────────────────────────────────────────────────────────"
echo "  NEXT STEPS:"
echo "  ────────────────────────────────────────────────────────────"
echo ""
echo "  1. Update your .env file:"
echo ""
echo "     ANCHOR_PROGRAM_ID=$PROGRAM_ID"
echo ""
echo "  2. Update program/Anchor.toml [programs.devnet] section:"
echo ""
echo "     tribe = \"$PROGRAM_ID\""
echo ""
echo "  3. Update the declare_id!() macro in program/programs/tribe/src/lib.rs:"
echo ""
echo "     declare_id!(\"$PROGRAM_ID\");"
echo ""
echo "  4. Rebuild after updating the program ID:"
echo ""
echo "     cd program && anchor build"
echo ""
echo "══════════════════════════════════════════════════════════════"
echo ""

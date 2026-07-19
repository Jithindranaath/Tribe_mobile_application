# Deploying the TRIBE server

The server is a long-running Node process (WebSocket clients via `ws`, persistent SSE
upstream connections to TxLINE) — it needs a platform that runs a persistent container,
not a serverless/edge function platform (Vercel functions, Cloudflare Workers, etc. won't
work for this).

## Build

```bash
docker build -f server/Dockerfile -t tribe-server .
```

Run from the **repo root** (not `server/`) — the build needs the root `package-lock.json`
since this is an npm workspaces monorepo.

## Run locally to verify the image

```bash
docker run -p 3001:3001 --env-file server/.env tribe-server
curl http://localhost:3001/health
```

## Required environment variables

All are read as optional by `server/src/config/env.ts` (the server degrades gracefully —
logs and skips the relevant feature — if one is missing, rather than crashing), but for a
real deployment you want all of these set:

| Variable | Purpose |
|---|---|
| `PORT` | defaults to 3001; most platforms inject this automatically |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only, never expose to the client) |
| `SOLANA_RPC_URL` | devnet RPC endpoint |
| `SOLANA_NETWORK` | `devnet` |
| `ANCHOR_PROGRAM_ID` | deployed Tribe program id |
| `TXLINE_API_BASE_URL` | `https://txline-dev.txodds.com/api` |
| `TXLINE_API_TOKEN` | TxLINE API token (or leave unset — the server acquires one at boot via the guest JWT flow if `TXLINE_WALLET_KEYPAIR` is set) |
| `TXLINE_WALLET_KEYPAIR` | service wallet keypair (JSON byte array) — sponsors on-chain fan/settlement transactions and TxLINE subscription activation. **Treat as a secret.** |
| `ANTHROPIC_API_KEY` | used for Keeper read-prompt generation |

## Platform notes

- **Health check**: `GET /health` → `{"status":"ok","service":"tribe-server","timestamp":...}`.
  Point any platform's health check config at this.
- **WebSocket**: the platform must proxy WebSocket upgrades (`Upgrade: websocket`) through
  to the container on the same port as HTTP — Fly.io, Railway, and Render all do this by
  default for a single exposed port; double check if using something else.
- Once deployed, update `mobile/.env`'s server URL from the LAN IP
  (`192.168.0.163` at last check) to the deployed URL so the mobile app talks to the
  public server instead of localhost.

## Current deployment (OCI Compute VM)

Deployed 2026-07-20 to an OCI Always Free `VM.Standard.E2.1.Micro` instance
(`ap-hyderabad-1`, existing VCN/subnet from the tenancy's default setup — port 3001 was
already open in that subnet's security list from a prior project). A1.Flex (ARM, more
resources) hit "Out of host capacity" — a common issue with OCI's free-tier ARM shapes —
so this fell back to the x86 micro shape instead.

- **Public URL**: `http://140.245.192.149:3001` (also in `mobile/.env`)
- **SSH**: `ssh -i ~/.ssh/tribe_oci ubuntu@140.245.192.149` (dedicated key generated this
  session, not the user's personal OCI key)
- Repo synced via `rsync` (not git clone — avoids needing repo credentials on the VM);
  image built directly on the VM with `sudo docker build -f server/Dockerfile -t tribe-server .`
  from `~/repo`; run via `sudo docker run -d --name tribe-server --restart unless-stopped
  -p 3001:3001 --env-file ~/repo/server/.env tribe-server`. `--restart unless-stopped` means
  it survives a VM reboot.
- Verified end-to-end from this machine (not just on the VM): `GET /health` → 200, and a
  raw WebSocket upgrade handshake succeeded against the public IP.
- **The local dev server was intentionally stopped** once this went live — running both
  concurrently risks double-processing (duplicate settlements, duplicate rank refreshes)
  against the same Supabase project and on-chain program if a live match/replay is active
  on both at once. This OCI instance is now the single source of truth.
- To update after a code change: re-`rsync` the changed files to `~/repo` on the VM,
  `sudo docker build ... && sudo docker stop tribe-server && sudo docker rm tribe-server`,
  then re-run the `docker run` command above.
- E2.1.Micro is small (1/8 OCPU, 1GB RAM) — the build itself took a few minutes (slow but
  fine, one-time cost); runtime performance for a single-fixture demo should be adequate,
  but this is not a high-throughput instance.

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

# TRIBE server — long-running process (WebSocket + SSE upstream connections
# to TxLINE), not a fit for serverless/edge platforms. Build from the repo
# root (npm workspaces share one root lockfile): `docker build -f server/Dockerfile .`

FROM node:22-slim AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY server/package.json server/package.json

# --ignore-scripts: skips the root "prepare" (husky) lifecycle script, which
# only matters for local git hooks and fails in a scriptless container
# checkout anyway. None of the server's dependencies need install/postinstall
# hooks (checked: cors, dotenv, express, ws, eventsource, @supabase/supabase-js,
# @solana/web3.js, @coral-xyz/anchor, satori, @resvg/resvg-js — all clean;
# @resvg/resvg-js resolves its native binary via optionalDependencies, not a hook).
RUN npm ci --workspace=server --ignore-scripts

COPY tsconfig.base.json ./
COPY server/ server/
RUN npm run build --workspace=server

FROM node:22-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci --workspace=server --omit=dev --ignore-scripts

COPY --from=build /repo/server/dist server/dist

WORKDIR /repo/server
EXPOSE 3001
CMD ["node", "dist/index.js"]

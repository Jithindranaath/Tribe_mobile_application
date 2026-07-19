# TRIBE — Mobile Application

> **"Sports are the last acceptable tribalism — we built the operating system for it."**

TRIBE is a cross-platform mobile app (Expo/React Native) for the 2026 FIFA World Cup. Fans join tribes, gather around a Digital Campfire during live matches, make collective predictions (Reads), and earn soulbound reputation (Standing) — all powered by live TxLINE oracle data on Solana.

---

## Screenshots

| Onboarding | Campfire (Live) | Campfire (Blazing) |
|:---:|:---:|:---:|
| Pick your jersey & city | Real-time match with tribe | Surge after correct Read |

---

## Architecture

```
┌─── TxLINE Oracle (SSE) ──────────────────────────┐
│  Live scores + odds, Solana-anchored              │
└──────────────────┬────────────────────────────────┘
                   │ ingest
┌──────────────────▼──── Server (Node.js) ──────────┐
│  WebSocket fan-out · Read resolution · Settlement  │
└──────────────────┬────────────────────────────────┘
                   │ WebSocket + REST
┌──────────────────▼──── Mobile App (Expo) ─────────┐
│  Campfire · Onboarding · Standings · Legacy        │
└──────────────────┬────────────────────────────────┘
                   │ settles on-chain
┌──────────────────▼──── Solana (Anchor) ───────────┐
│  FanAccount · TribeAccount · ReadRecord PDAs       │
└───────────────────────────────────────────────────┘
```

---

## Project Structure

```
├── mobile/                   # Expo/React Native mobile app
│   ├── app/                  # expo-router file-based routes
│   │   ├── (auth)/           # Onboarding flow
│   │   ├── (main)/           # Tab screens (Campfire, Standings, Legacy, Profile)
│   │   └── (match)/          # Deep-linked match + replay screens
│   ├── components/           # UI components (campfire, onboarding, etc.)
│   ├── hooks/                # WebSocket, notifications, deep links
│   ├── lib/                  # REST API client, cache, deep linking
│   ├── providers/            # Auth + Theme providers
│   ├── stores/               # Zustand state management
│   ├── types/                # TypeScript interfaces
│   └── __tests__/            # Property-based tests (fast-check)
│
├── server/                   # Node.js backend
│   ├── src/                  # Express + WebSocket + TxLINE adapter
│   │   ├── txline/           # TxLINE auth, streams, replay, subscription
│   │   ├── services/         # Reads, conviction, settlement, surge
│   │   ├── keeper/           # AI moment surfacing
│   │   └── ws/               # WebSocket server
│   └── scripts/              # Utilities (wallet gen, demo simulation)
│
└── program/                  # Anchor (Rust) Solana program
    ├── programs/tribe/       # FanAccount, TribeAccount, ReadRecord
    └── Anchor.toml
```

---

## Setup

### Prerequisites

- Node.js 20+
- Expo Go app on your phone (v54+)
- USB cable + USB debugging enabled on Android

### 1. Install Dependencies

```bash
cd mobile
npm install --legacy-peer-deps

cd ../server
npm install
```

### 2. Environment Variables

Create `mobile/.env`:
```
EXPO_PUBLIC_API_URL=http://<your-local-ip>:3001
EXPO_PUBLIC_WS_URL=ws://<your-local-ip>:3001
EXPO_PUBLIC_PRIVY_APP_ID=your-privy-app-id
```

Create `server/.env`:
```
PORT=3001
SUPABASE_URL=your-supabase-url
SUPABASE_KEY=your-supabase-key
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
TXLINE_API_BASE_URL=https://txline-dev.txodds.com/api
TXLINE_WALLET_KEYPAIR=[...]
TXLINE_API_TOKEN=your-token
SOLANA_RPC_URL=https://api.devnet.solana.com
```

### 3. Run the App

```bash
# Terminal 1: Start server
cd server
npx tsx src/index.ts

# Terminal 2: Start mobile
cd mobile
npx expo start
# Then scan QR code with Expo Go, or press 'a' for Android
```

### 4. Demo Mode (No Server Needed)

The Campfire screen has a built-in demo simulation. Just open the app and tap **"▶ Start Live Demo"** to see:
- Live match header (Brazil vs Argentina)
- Flame intensity changing (dim → steady → bright → blazing)
- Read prompts appearing with YES/NO buttons
- Surge celebration overlay on correct prediction
- Keeper messages appearing at key moments

---

## Testing

```bash
cd mobile
npm test
# 14 test suites, 32 property-based tests (fast-check)
```

### Property Tests Cover:
1. Flame intensity mapping (bounded + monotonic)
2. Expired Read prompt dismissal
3. WebSocket message routing correctness
4. Exponential backoff delay computation
5. Read commit channel selection (WS vs REST)
6. Duplicate read commit prevention
7. Tribe standings display completeness
8. Deep link routing
9. Moment card display completeness
10. Title bitmask decoding
11. Fan statistics computation
12. Replay mode local-only resolution
13. Cache persistence after fetch
14. Read commit message schema validity

---

## Features Implemented

| Feature | Status |
|---------|--------|
| Onboarding (Jersey → City → Login) | ✅ |
| Tab Navigation (Campfire, Standings, Legacy, Profile) | ✅ |
| Campfire with live match data | ✅ |
| WebSocket real-time communication | ✅ |
| Read predictions with haptic feedback | ✅ |
| Surge celebrations | ✅ |
| Flame intensity visualization | ✅ |
| Conviction signal + presence count | ✅ |
| Standings with segmented views | ✅ |
| Profile with titles + stats | ✅ |
| Deep linking | ✅ |
| Replay mode | ✅ |
| Offline SQLite cache | ✅ |
| Push notifications | ✅ |
| Share cards via expo-sharing | ✅ |
| Self-contained demo simulation | ✅ |
| 14 property-based tests | ✅ |
| Live TxLINE data streaming (real devnet, verified repeatedly) | ✅ |
| Solana program deployed to devnet (`8Yc8JQutXw9rkS1VSYdGEkChGYJhkJKuw64v1CmdN5H8`) | ✅ |
| Backend server deployed (OCI Compute, public URL) | ✅ |

---

## What's Left to Do

| Task | Blocker |
|------|---------|
| Real Privy auth confirmed end-to-end on a physical device | Needs Android Studio development build |
| NativeWind styling in dev build | Needs `npx expo run:android` (Java + Android SDK) |
| Production Lottie flame animations | Designer assets needed |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile | Expo SDK 54 + React Native + expo-router |
| State | Zustand |
| Realtime | WebSocket (custom hook with exponential backoff) |
| Animation | react-native-reanimated |
| Cache | expo-sqlite |
| Auth | Privy (mocked in Expo Go, real in dev build) |
| Backend | Node.js + Express + WebSocket |
| On-Chain | Anchor (Rust) on Solana devnet |
| Oracle | TxLINE SSE streams (scores + odds) |
| Testing | Jest + fast-check (property-based) |

---

## TxLINE Integration

| Endpoint | Usage |
|----------|-------|
| `GET /api/scores/stream` (SSE) | Live match events → Read resolution |
| `GET /api/odds/stream` (SSE) | Read difficulty + drama triggers |
| `GET /api/scores/historical/{id}` | Replay mode |
| `POST /auth/guest/start` | JWT auth |
| `POST /api/token/activate` | API token activation |

---

## Hackathon

**Event:** Superteam World Cup 2026 — TxLINE Track  
**Deadline:** July 19, 2026, 23:59 UTC  
**Prizes:** 1st 10,000 USDT · 2nd 4,000 · 3rd 2,000

---

*"The crypto is invisible. The tribe is loud."*

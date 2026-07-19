import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { PublicKey } from '@solana/web3.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockMaybeSingle = vi.fn();
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelectAfterInsert = vi.fn();
const mockSingle = vi.fn();

const mockFrom = vi.fn((table: string) => ({
  select: vi.fn(() => ({ eq: mockEq })),
  insert: vi.fn(() => ({
    select: vi.fn(() => ({ single: mockSingle })),
  })),
}));

vi.mock('../lib/supabase.js', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

const mockGetOrCreateTribeAccount = vi.fn();
const mockGetOrCreateFanAccount = vi.fn();

vi.mock('../services/onchain.js', () => ({
  getOrCreateTribeAccount: (...args: unknown[]) => mockGetOrCreateTribeAccount(...args),
  getOrCreateFanAccount: (...args: unknown[]) => mockGetOrCreateFanAccount(...args),
}));

const mockSetCachedFanStanding = vi.fn().mockResolvedValue(undefined);
const mockBumpCachedTribeAggregateStanding = vi.fn().mockResolvedValue(undefined);

vi.mock('../services/standing-cache.js', () => ({
  setCachedFanStanding: (...args: unknown[]) => mockSetCachedFanStanding(...args),
  bumpCachedTribeAggregateStanding: (...args: unknown[]) => mockBumpCachedTribeAggregateStanding(...args),
}));

import authRouter from './auth.js';

// ─── Helper: lightweight request without supertest ────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

async function startApp() {
  const app = createApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    return { status: res.status, body: json };
  };

  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));

  return { post, close };
}

const FAKE_WALLET = new PublicKey('11111111111111111111111111111111').toBase58();
const FAKE_TRIBE_PDA = new PublicKey('11111111111111111111111111111111');

const validBody = {
  privyUserId: 'privy-user-1',
  tribeId: 'brazil-brazil-hyderabad',
  tribeName: 'Brazil · Hyderabad',
  macroTribe: 'Brazil',
  walletAddress: FAKE_WALLET,
};

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockGetOrCreateTribeAccount.mockResolvedValue({
      macroId: 1,
      regionId: 2,
      pda: FAKE_TRIBE_PDA,
    });
    mockGetOrCreateFanAccount.mockResolvedValue({
      pda: FAKE_TRIBE_PDA,
      standing: 100,
      titles: 0,
      readsCorrect: 0,
      readsTotal: 0,
      isNew: true,
    });
  });

  it('registers a new fan: creates tribe + fan on-chain, persists mapping, returns profile', async () => {
    mockSingle.mockResolvedValue({
      data: {
        fan_id: 'fan-uuid-1',
        privy_user_id: 'privy-user-1',
        wallet_pubkey: FAKE_WALLET,
        tribe_id: 'brazil-brazil-hyderabad',
        tribe_name: 'Brazil · Hyderabad',
        macro_tribe: 'Brazil',
        created_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });

    const { post, close } = await startApp();
    try {
      const res = await post('/api/auth/register', validBody);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        fanId: 'fan-uuid-1',
        privyUserId: 'privy-user-1',
        tribeId: 'brazil-brazil-hyderabad',
        tribeName: 'Brazil · Hyderabad',
        macroTribe: 'Brazil',
        standing: 100,
        titles: 0,
        readsCorrect: 0,
        readsTotal: 0,
        currentStreak: 0,
      });
      expect(mockGetOrCreateTribeAccount).toHaveBeenCalledWith(
        'brazil-brazil-hyderabad',
        'Brazil',
      );
      expect(mockGetOrCreateFanAccount).toHaveBeenCalledWith(FAKE_WALLET, FAKE_TRIBE_PDA);
    } finally {
      await close();
    }
  });

  it('is idempotent: returns the existing profile without re-inserting when already registered', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        fan_id: 'fan-uuid-1',
        privy_user_id: 'privy-user-1',
        wallet_pubkey: FAKE_WALLET,
        tribe_id: 'brazil-brazil-hyderabad',
        tribe_name: 'Brazil · Hyderabad',
        macro_tribe: 'Brazil',
        created_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    });
    mockGetOrCreateFanAccount.mockResolvedValue({
      pda: FAKE_TRIBE_PDA,
      standing: 340,
      titles: 1,
      readsCorrect: 8,
      readsTotal: 10,
      isNew: false,
    });

    const { post, close } = await startApp();
    try {
      const res = await post('/api/auth/register', validBody);

      expect(res.status).toBe(200);
      expect(res.body.fanId).toBe('fan-uuid-1');
      expect(res.body.standing).toBe(340); // fresh on-chain value, not stale
      expect(mockSingle).not.toHaveBeenCalled(); // no new insert attempted
    } finally {
      await close();
    }
  });

  it('returns 400 when required fields are missing', async () => {
    const { walletAddress, ...body } = validBody;
    const { post, close } = await startApp();
    try {
      const res = await post('/api/auth/register', body);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('walletAddress');
    } finally {
      await close();
    }
  });

  it('returns 500 when persisting the fan record fails', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'insert failed' } });

    const { post, close } = await startApp();
    try {
      const res = await post('/api/auth/register', validBody);
      expect(res.status).toBe(500);
    } finally {
      await close();
    }
  });

  it('returns 500 when on-chain account creation throws', async () => {
    mockGetOrCreateTribeAccount.mockRejectedValue(new Error('RPC timeout'));

    const { post, close } = await startApp();
    try {
      const res = await post('/api/auth/register', validBody);
      expect(res.status).toBe(500);
    } finally {
      await close();
    }
  });
});

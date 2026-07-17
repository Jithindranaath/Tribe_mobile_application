import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import readsRouter from './reads.js';

// Mock the reads service
vi.mock('../services/reads.js', () => ({
  commitRead: vi.fn(),
}));

import { commitRead } from '../services/reads.js';

const mockedCommitRead = vi.mocked(commitRead);

// ─── Helper: lightweight request without supertest ────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/reads', readsRouter);
  return app;
}

/** Starts the app on a random port and returns a fetch helper */
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('POST /api/reads/commit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validBody = {
    readId: 'read-123',
    fanId: 'fan-456',
    fixtureId: 12345,
    readType: 'moment_read',
    predicted: 1,
    oddsAtCommit: 2.5,
  };

  it('should return 201 on successful commit', async () => {
    mockedCommitRead.mockResolvedValue({ success: true, readId: 'read-123' });

    const { post, close } = await startApp();
    try {
      const res = await post('/api/reads/commit', validBody);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, readId: 'read-123' });
      expect(mockedCommitRead).toHaveBeenCalledWith({
        readId: 'read-123',
        fanId: 'fan-456',
        fixtureId: 12345,
        readType: 'moment_read',
        predicted: 1,
        oddsAtCommit: 2.5,
      });
    } finally {
      await close();
    }
  });

  it('should return 409 when already committed', async () => {
    mockedCommitRead.mockResolvedValue({
      success: false,
      readId: 'read-123',
      error: 'Already committed for this Read',
    });

    const { post, close } = await startApp();
    try {
      const res = await post('/api/reads/commit', validBody);
      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Already committed for this Read');
    } finally {
      await close();
    }
  });

  it('should return 400 when readId is missing', async () => {
    const { readId, ...body } = validBody;
    const { post, close } = await startApp();
    try {
      const res = await post('/api/reads/commit', body);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('readId');
    } finally {
      await close();
    }
  });

  it('should return 400 when fanId is missing', async () => {
    const { fanId, ...body } = validBody;
    const { post, close } = await startApp();
    try {
      const res = await post('/api/reads/commit', body);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('fanId');
    } finally {
      await close();
    }
  });

  it('should return 400 when fixtureId is missing', async () => {
    const { fixtureId, ...body } = validBody;
    const { post, close } = await startApp();
    try {
      const res = await post('/api/reads/commit', body);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('fixtureId');
    } finally {
      await close();
    }
  });

  it('should return 400 when fixtureId is not a number', async () => {
    const { post, close } = await startApp();
    try {
      const res = await post('/api/reads/commit', { ...validBody, fixtureId: 'not-a-number' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('fixtureId');
    } finally {
      await close();
    }
  });

  it('should return 400 when readType is missing', async () => {
    const { readType, ...body } = validBody;
    const { post, close } = await startApp();
    try {
      const res = await post('/api/reads/commit', body);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('readType');
    } finally {
      await close();
    }
  });

  it('should return 400 when predicted is missing', async () => {
    const { predicted, ...body } = validBody;
    const { post, close } = await startApp();
    try {
      const res = await post('/api/reads/commit', body);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('predicted');
    } finally {
      await close();
    }
  });

  it('should return 400 when oddsAtCommit is missing', async () => {
    const { oddsAtCommit, ...body } = validBody;
    const { post, close } = await startApp();
    try {
      const res = await post('/api/reads/commit', body);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('oddsAtCommit');
    } finally {
      await close();
    }
  });

  it('should return 500 when service throws', async () => {
    mockedCommitRead.mockRejectedValue(new Error('DB connection failed'));

    const { post, close } = await startApp();
    try {
      const res = await post('/api/reads/commit', validBody);
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('DB connection failed');
    } finally {
      await close();
    }
  });
});

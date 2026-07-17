/**
 * Reads API router — POST /commit endpoint for Read commitment.
 *
 * Requirements: 9.1, 9.2
 */

import { Router, Request, Response } from 'express';
import { commitRead } from '../services/reads.js';

const router = Router();

/**
 * POST /commit
 * Body: { readId, fanId, fixtureId, readType, predicted, oddsAtCommit }
 *
 * Creates a reads_live record with status 'pending'.
 * Rate-limited: one commit per fan per readId.
 */
router.post('/commit', async (req: Request, res: Response) => {
  const { readId, fanId, fixtureId, readType, predicted, oddsAtCommit } = req.body;

  // Validate required fields
  if (!readId || typeof readId !== 'string') {
    return res.status(400).json({ success: false, error: 'readId is required (string)' });
  }
  if (!fanId || typeof fanId !== 'string') {
    return res.status(400).json({ success: false, error: 'fanId is required (string)' });
  }
  if (fixtureId == null || typeof fixtureId !== 'number') {
    return res.status(400).json({ success: false, error: 'fixtureId is required (number)' });
  }
  if (!readType || typeof readType !== 'string') {
    return res.status(400).json({ success: false, error: 'readType is required (string)' });
  }
  if (predicted == null || typeof predicted !== 'number') {
    return res.status(400).json({ success: false, error: 'predicted is required (number)' });
  }
  if (oddsAtCommit == null || typeof oddsAtCommit !== 'number') {
    return res.status(400).json({ success: false, error: 'oddsAtCommit is required (number)' });
  }

  try {
    const result = await commitRead({
      readId,
      fanId,
      fixtureId,
      readType,
      predicted,
      oddsAtCommit,
    });

    if (!result.success) {
      return res.status(409).json(result);
    }

    return res.status(201).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;

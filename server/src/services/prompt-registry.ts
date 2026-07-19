/**
 * In-memory registry of broadcast Read prompt metadata.
 *
 * The REST commit route (`POST /api/reads/commit`) receives `readType` and
 * `oddsAtCommit` directly from the client. The WebSocket `read_commit`
 * message does not (`ClientReadCommitMessage` only carries `{readId,
 * predicted}`) — the server is the one that generated and broadcast the
 * prompt in the first place, so it registers the metadata here when
 * broadcasting and looks it up when a WS commit for that readId arrives.
 */

interface PromptMeta {
  fixtureId: string;
  readType: string;
  oddsAtCommit: number;
  expiresAt: number;
}

const registry = new Map<string, PromptMeta>();

export function registerPrompt(readId: string, meta: PromptMeta): void {
  registry.set(readId, meta);
}

export function getPromptMeta(readId: string): PromptMeta | undefined {
  return registry.get(readId);
}

/** Removes entries past their expiry. Call periodically to bound memory. */
export function clearExpiredPrompts(): void {
  const now = Date.now();
  for (const [readId, meta] of registry.entries()) {
    if (meta.expiresAt < now) {
      registry.delete(readId);
    }
  }
}

/** Resets the registry. For testing only. */
export function _resetPromptRegistry(): void {
  registry.clear();
}

import { create } from "zustand";
import { signalToIntensity } from "../types";
import type {
  FlameIntensity,
  MatchHeader,
  PendingRead,
  PresencePayload,
  ConvictionPayload,
  ReadPromptPayload,
  SurgePayload,
  KeeperInjectPayload,
  ShareCardReadyPayload,
} from "../types";

interface CampfireState {
  // Connection
  connected: boolean;
  reconnectAttempts: number;

  // Match data
  fixtureId: string | null;
  matchHeader: MatchHeader | null;

  // Real-time state
  presence: PresencePayload | null;
  conviction: ConvictionPayload | null;
  flameIntensity: FlameIntensity;

  // Read flow
  activePrompt: ReadPromptPayload | null;
  pendingReads: Map<string, PendingRead>;
  committedReadIds: Set<string>;

  // Surge
  surgeActive: boolean;
  surgePayload: SurgePayload | null;

  // Keeper
  keeperMessage: KeeperInjectPayload | null;

  // Share
  shareCard: ShareCardReadyPayload | null;

  // Replay
  isReplayMode: boolean;

  // Deep link context
  deepLinkTribeId: string | null;
  deepLinkShareCardId: string | null;

  // Actions
  commitRead: (readId: string, predicted: number) => void;
  dismissPrompt: () => void;
  dismissSurge: () => void;
  setTribeContext: (tribeId: string) => void;
  setShareCardFromDeepLink: (cardId: string) => void;
  clearDeepLinkContext: () => void;
}

export const useCampfireStore = create<CampfireState>((set, get) => ({
  // Connection
  connected: false,
  reconnectAttempts: 0,

  // Match data
  fixtureId: null,
  matchHeader: null,

  // Real-time state
  presence: null,
  conviction: null,
  flameIntensity: "dim",

  // Read flow
  activePrompt: null,
  pendingReads: new Map<string, PendingRead>(),
  committedReadIds: new Set<string>(),

  // Surge
  surgeActive: false,
  surgePayload: null,

  // Keeper
  keeperMessage: null,

  // Share
  shareCard: null,

  // Replay
  isReplayMode: false,

  // Deep link context
  deepLinkTribeId: null,
  deepLinkShareCardId: null,

  // ─── Actions ─────────────────────────────────────────────────────────────────

  commitRead: (readId, predicted) => {
    const { committedReadIds, pendingReads, activePrompt } = get();

    // Duplicate prevention — no-op if already committed
    if (committedReadIds.has(readId)) {
      return;
    }

    // Build the pending read entry
    const pendingRead: PendingRead = {
      readId,
      predicted,
      committedAt: Date.now(),
      readType: activePrompt?.readType ?? "moment_read",
      question: activePrompt?.question ?? "",
    };

    // Immutable update: clone collections with new entry
    const newCommittedIds = new Set(committedReadIds);
    newCommittedIds.add(readId);

    const newPendingReads = new Map(pendingReads);
    newPendingReads.set(readId, pendingRead);

    set({
      committedReadIds: newCommittedIds,
      pendingReads: newPendingReads,
      activePrompt: null, // clear the prompt after commitment
    });
  },

  dismissPrompt: () => set({ activePrompt: null }),

  dismissSurge: () => set({ surgeActive: false, surgePayload: null }),

  setTribeContext: (tribeId: string) => set({ deepLinkTribeId: tribeId }),

  setShareCardFromDeepLink: (cardId: string) => set({ deepLinkShareCardId: cardId }),

  clearDeepLinkContext: () => set({ deepLinkTribeId: null, deepLinkShareCardId: null }),
}));

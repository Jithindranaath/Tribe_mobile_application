import { useEffect, useRef, useCallback, useState } from "react";
import { useCampfireStore } from "../stores";
import { signalToIntensity } from "../types";
import type {
  WSMessage,
  WSEventType,
  PresencePayload,
  ConvictionPayload,
  SurgePayload,
  KeeperInjectPayload,
  StandingUpdatePayload,
  ShareCardReadyPayload,
} from "../types";
import type { ReadPromptPayload } from "../types";

// ─── Constants ───────────────────────────────────────────────────────────────

const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? "ws://localhost:3001";
const PING_INTERVAL_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 4;

/** Exported for testing: backoff delays in milliseconds */
export const BACKOFF_SCHEDULE = [1000, 2000, 4000, 8000];

/**
 * Returns the backoff delay for a given attempt index.
 * Exported for property-based testing (Property 4).
 */
export function getBackoffDelay(attempt: number): number {
  if (attempt < 0 || attempt >= BACKOFF_SCHEDULE.length) {
    return BACKOFF_SCHEDULE[BACKOFF_SCHEDULE.length - 1];
  }
  return BACKOFF_SCHEDULE[attempt];
}

// ─── Hook Params & Return ────────────────────────────────────────────────────

interface UseCampfireSocketParams {
  tribeId: string;
  fixtureId: string;
}

interface UseCampfireSocketReturn {
  connect: () => void;
  disconnect: () => void;
  retry: () => void;
  isConnected: boolean;
  isOffline: boolean;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useCampfireSocket({
  tribeId,
  fixtureId,
}: UseCampfireSocketParams): UseCampfireSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const unmountedRef = useRef(false);

  const [isConnected, setIsConnected] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // ─── Store Actions ───────────────────────────────────────────────────────────

  const updateStore = useCallback(
    (msg: WSMessage) => {
      switch (msg.type as WSEventType) {
        case "presence":
          useCampfireStore.setState({
            presence: msg.payload as PresencePayload,
          });
          break;

        case "conviction": {
          const convictionPayload = msg.payload as ConvictionPayload;
          useCampfireStore.setState({
            conviction: convictionPayload,
            flameIntensity: signalToIntensity(convictionPayload.signal),
          });
          break;
        }

        case "read_prompt":
          useCampfireStore.setState({
            activePrompt: msg.payload as ReadPromptPayload,
          });
          break;

        case "surge":
          useCampfireStore.setState({
            surgeActive: true,
            surgePayload: msg.payload as SurgePayload,
          });
          break;

        case "keeper_inject":
          useCampfireStore.setState({
            keeperMessage: msg.payload as KeeperInjectPayload,
          });
          break;

        case "standing_update": {
          // Standing updates are consumed by the standings/profile stores.
          // The campfire store doesn't hold a dedicated field, but we can
          // signal that an update was received for any listeners.
          void (msg.payload as StandingUpdatePayload);
          break;
        }

        case "share_card_ready":
          useCampfireStore.setState({
            shareCard: msg.payload as ShareCardReadyPayload,
          });
          break;
      }
    },
    []
  );

  // ─── Ping Keepalive ──────────────────────────────────────────────────────────

  const startPing = useCallback(() => {
    stopPing();
    pingTimerRef.current = setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, PING_INTERVAL_MS);
  }, []);

  const stopPing = useCallback(() => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  // ─── Connection Logic ────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const url = `${WS_URL}?tribeId=${encodeURIComponent(tribeId)}&fixtureId=${encodeURIComponent(fixtureId)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) {
        ws.close();
        return;
      }
      reconnectAttemptRef.current = 0;
      setIsConnected(true);
      setIsOffline(false);
      useCampfireStore.setState({ connected: true, reconnectAttempts: 0 });
      startPing();
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg: WSMessage = JSON.parse(
          typeof event.data === "string" ? event.data : ""
        );
        updateStore(msg);
      } catch {
        // Silently drop malformed messages
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      useCampfireStore.setState({ connected: false });
      stopPing();
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose fires after onerror; reconnection handled there
    };
  }, [tribeId, fixtureId, startPing, stopPing, updateStore]);

  // ─── Reconnection with Exponential Backoff ───────────────────────────────────

  const scheduleReconnect = useCallback(() => {
    if (unmountedRef.current) return;

    const attempt = reconnectAttemptRef.current;

    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      // Max retries exhausted — show offline indicator
      setIsOffline(true);
      useCampfireStore.setState({ reconnectAttempts: attempt });
      return;
    }

    const delay = getBackoffDelay(attempt);
    reconnectAttemptRef.current = attempt + 1;
    useCampfireStore.setState({ reconnectAttempts: attempt + 1 });

    reconnectTimerRef.current = setTimeout(() => {
      connect();
    }, delay);
  }, [connect]);

  // ─── Manual Retry (from offline state) ───────────────────────────────────────

  const retry = useCallback(() => {
    // Reset attempts and reconnect
    reconnectAttemptRef.current = 0;
    setIsOffline(false);
    useCampfireStore.setState({ reconnectAttempts: 0 });
    connect();
  }, [connect]);

  // ─── Disconnect ──────────────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    stopPing();

    if (wsRef.current) {
      wsRef.current.onclose = null; // Prevent reconnect on intentional close
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
    setIsOffline(false);
    useCampfireStore.setState({ connected: false, reconnectAttempts: 0 });
  }, [stopPing]);

  // ─── Lifecycle: connect on mount, disconnect on unmount ──────────────────────

  useEffect(() => {
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      disconnect();
    };
  }, [tribeId, fixtureId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    connect,
    disconnect,
    retry,
    isConnected,
    isOffline,
  };
}

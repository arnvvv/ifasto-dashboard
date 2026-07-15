"use client";

// Live queue state: REST snapshot on mount + WebSocket subscription.
// Keeps a single source of truth (entries list + summary) and re-syncs from
// REST when the WS reconnects, so a missed event window doesn't leave the UI
// stale.

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import {
  type QueueEntry,
  type QueueState,
  queueApi,
  wsUrl,
} from "./queue";

interface UseQueueResult {
  entries: QueueEntry[];
  state: QueueState | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
  refresh: () => Promise<void>;
}

export function useQueue(token: string | null): UseQueueResult {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [state, setState] = useState<QueueState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [list, summary] = await Promise.all([
        queueApi.list(token),
        queueApi.state(token),
      ]);
      setEntries(list);
      setState(summary);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`Queue load failed (${err.status}): ${err.message}`);
      } else {
        setError("Could not reach the queue service.");
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Initial fetch.
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    void refresh();
  }, [token, refresh]);

  // WebSocket subscription with auto-reconnect (capped backoff).
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let attempt = 0;

    function connect() {
      if (cancelled) return;
      const ws = new WebSocket(wsUrl(token!));
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        // Re-sync from REST in case we missed events during the gap.
        void refresh();
      };

      ws.onmessage = (msg) => {
        try {
          const evt = JSON.parse(msg.data) as {
            event: string;
            entry?: QueueEntry;
            state?: QueueState;
          };
          if (evt.state) setState(evt.state);
          if (evt.entry) {
            const entry = evt.entry;
            setEntries((prev) => {
              const idx = prev.findIndex((e) => e.id === entry.id);
              if (evt.event === "joined" || evt.event === "reinstated") {
                return idx >= 0 ? prev : [...prev, entry];
              }
              // called / uncalled — still waiting, update in place.
              if (evt.event === "called" || evt.event === "uncalled") {
                return idx >= 0
                  ? prev.map((e) => (e.id === entry.id ? entry : e))
                  : prev;
              }
              // seated / walked_away — entry leaves the waiting list.
              return idx >= 0 ? prev.filter((e) => e.id !== entry.id) : prev;
            });
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        attempt = Math.min(attempt + 1, 6);
        const delay = Math.min(1000 * 2 ** attempt, 15000);
        retryRef.current = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // close handler will manage retry
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (retryRef.current) window.clearTimeout(retryRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [token, refresh]);

  return { entries, state, loading, error, connected, refresh };
}

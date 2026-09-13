"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FEEDS } from "@/lib/live/feeds";
import { getLiveSnapshot } from "@/lib/live/snapshot";
import type { LiveSnapshot } from "@/lib/live/types";

// Polls /api/live every minute while the page is visible, and right away when you come back to it.
// The static preview has no API routes, so there it loads the feeds that allow browser requests.

export const LIVE_POLL_MS = 60_000;
const MIN_GAP_MS = 15_000;

export interface LiveState {
  snapshot: LiveSnapshot | null;
  status: "loading" | "live" | "error";
  mode: "server" | "browser";
  lastUpdated: number | null;
  refreshing: boolean;
}

export function useLiveIncidents(): LiveState & { refresh: () => void } {
  const [state, setState] = useState<LiveState>({ snapshot: null, status: "loading", mode: "server", lastUpdated: null, refreshing: false });
  const mode = useRef<"server" | "browser">("server");
  const busy = useRef(false);
  const lastLoad = useRef(0);

  const load = useCallback(async (force = false) => {
    if (busy.current || (!force && Date.now() - lastLoad.current < MIN_GAP_MS)) return;
    busy.current = true;
    lastLoad.current = Date.now();
    setState((s) => ({ ...s, refreshing: true }));
    try {
      let snapshot: LiveSnapshot | null = null;
      if (mode.current === "server") {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (res.ok) snapshot = (await res.json()) as LiveSnapshot;
        else if (res.status === 404) mode.current = "browser";
        else throw new Error(`HTTP ${res.status}`);
      }
      if (!snapshot && mode.current === "browser") {
        snapshot = await getLiveSnapshot({ feeds: FEEDS.filter((f) => f.browser), server: false });
      }
      if (!snapshot) throw new Error("No live data");
      setState({ snapshot, status: "live", mode: mode.current, lastUpdated: Date.now(), refreshing: false });
    } catch {
      setState((s) => ({ ...s, status: s.snapshot ? "live" : "error", refreshing: false }));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true);
    }, LIVE_POLL_MS);
    const onReturn = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [load]);

  const refresh = useCallback(() => void load(true), [load]);
  return { ...state, refresh };
}

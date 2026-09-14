"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fallbackIssueMarkers } from "@/lib/issue-fallback";
import type { IssueMarker } from "@/lib/issue-types";

// City issues for the Places map, refreshed every minute so vote totals stay current.
// Only the static preview (no API) shows the saved sample issues; the live site never does.

const POLL_MS = 60_000;

export interface IssueMarkersState {
  issues: IssueMarker[];
  /** True when vote totals come from the database. */
  live: boolean;
  loaded: boolean;
}

export function useIssueMarkers(): IssueMarkersState & { refresh: () => void } {
  const [state, setState] = useState<IssueMarkersState>({ issues: [], live: false, loaded: false });
  const staticSite = useRef(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (staticSite.current) {
        setState({ issues: fallbackIssueMarkers(), live: false, loaded: true });
        return;
      }
      const res = await fetch("/api/issues", { cache: "no-store" });
      if (res.status === 404) {
        staticSite.current = true;
        setState({ issues: fallbackIssueMarkers(), live: false, loaded: true });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { live: boolean; issues: IssueMarker[] };
      setState({ issues: data.issues, live: data.live, loaded: true });
    } catch {
      setState((s) => (s.loaded ? s : { issues: [], live: false, loaded: true }));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    const onReturn = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [load]);

  const refresh = useCallback(() => void load(), [load]);
  return { ...state, refresh };
}

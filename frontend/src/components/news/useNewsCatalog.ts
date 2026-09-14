"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FEEDS } from "@/lib/live/feeds";
import { getLiveSnapshot } from "@/lib/live/snapshot";
import { incidentToNewsItem, newsworthyIncident } from "@/lib/news/incidents";
import { DISTRICT_ALIASES } from "@/lib/news/parse";
import type { NewsCatalog } from "@/lib/news/types";

// The Fremont news catalog, refreshed every minute while the tab is visible. Stories that arrive
// after the first load are collected in newIds. The static preview has no API, so it falls back to
// the live incidents browsers can load directly. The last catalog is kept for the whole visit, so the
// News page and group pages show it at once when opened again and refresh it in the background.

const POLL_MS = 60_000;
/** A catalog this fresh isn't fetched again when another page opens. */
const REUSE_MS = 20_000;
const NEIGHBORHOODS = Object.keys(DISTRICT_ALIASES);

let last: { catalog: NewsCatalog; preview: boolean; staticSite: boolean; at: number } | null = null;

export function useNewsCatalog() {
  const [catalog, setCatalog] = useState<NewsCatalog | null>(() => last?.catalog ?? null);
  const [status, setStatus] = useState<"loading" | "live" | "error">(() => (last ? "live" : "loading"));
  const [preview, setPreview] = useState(() => last?.preview ?? false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(() => last?.at ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const known = useRef<Set<string> | null>(null);
  const busy = useRef(false);
  const staticSite = useRef(last?.staticSite ?? false);

  const load = useCallback(async (force = true) => {
    if (busy.current || (!force && last && Date.now() - last.at < REUSE_MS)) return;
    busy.current = true;
    setRefreshing(true);
    try {
      let next: NewsCatalog | null = null;
      if (!staticSite.current) {
        const res = await fetch("/api/news", { cache: "no-store" });
        if (res.ok) next = (await res.json()) as NewsCatalog;
        else if (res.status === 404) staticSite.current = true;
        else throw new Error(`HTTP ${res.status}`);
      }
      if (!next && staticSite.current) {
        const live = await getLiveSnapshot({ feeds: FEEDS.filter((f) => f.browser), server: false }).catch(() => null);
        next = {
          generatedAt: new Date().toISOString(),
          items: (live?.incidents ?? []).filter(newsworthyIncident).map(incidentToNewsItem),
          alerts: live?.alerts ?? [],
          neighborhoods: NEIGHBORHOODS,
          sources: [],
        };
        setPreview(true);
      }
      if (!next) throw new Error("No news");
      const ids = next.items.map((i) => i.id);
      if (known.current) {
        const fresh = ids.filter((id) => !known.current?.has(id));
        if (fresh.length) setNewIds((current) => new Set([...current, ...fresh]));
        for (const id of ids) known.current.add(id);
      } else {
        known.current = new Set(ids);
      }
      const at = Date.now();
      last = { catalog: next, preview: staticSite.current, staticSite: staticSite.current, at };
      setCatalog(next);
      setStatus("live");
      setLastUpdated(at);
    } catch {
      setStatus((s) => (s === "live" ? "live" : "error"));
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Opened again within a few seconds: the catalog on screen is current, the next poll refreshes it.
    void load(false);
    const poll = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    const onReturn = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [load]);

  return { catalog, status, preview, lastUpdated, refreshing, newIds, load };
}

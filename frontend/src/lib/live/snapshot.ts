import { FEEDS, type Feed, type FeedResult } from "./feeds";
import type { FeedStatus, LiveAlert, LiveIncident, LiveSnapshot } from "./types";

// One cached entry per feed. Each feed refreshes on its own interval no matter how many people
// are watching, so the public sources see at most one request per interval from this server.
// When a feed fails, its last good data is kept (and marked stale) for a while.

interface Entry {
  checkedAt: number;
  result: FeedResult;
  okAt: number | null;
  error: string | null;
}

const EMPTY: FeedResult = { incidents: [], alerts: [] };
const RETRY_AFTER_ERROR_MS = 30_000;
const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

const staleLimitMs = (feed: Feed) => Math.max(feed.ttlMs * 5, 15 * 60_000);

async function refresh(feed: Feed, now: number, server: boolean): Promise<Entry> {
  const previous = entries.get(feed.id);
  let entry: Entry;
  try {
    entry = { checkedAt: now, result: await feed.load(now, { server }), okAt: now, error: null };
  } catch (error) {
    const okAt = previous?.okAt ?? null;
    const usable = okAt !== null && now - okAt <= staleLimitMs(feed);
    entry = {
      checkedAt: now,
      result: usable && previous ? previous.result : EMPTY,
      okAt,
      error: error instanceof Error ? error.message : "Unavailable",
    };
  }
  entries.set(feed.id, entry);
  return entry;
}

function entryFor(feed: Feed, now: number, server: boolean): Promise<Entry> {
  const cached = entries.get(feed.id);
  const ttl = cached?.error ? Math.min(feed.ttlMs, RETRY_AFTER_ERROR_MS) : feed.ttlMs;
  if (cached && now - cached.checkedAt < ttl) return Promise.resolve(cached);
  let pending = inflight.get(feed.id);
  if (!pending) {
    pending = refresh(feed, now, server).finally(() => inflight.delete(feed.id));
    inflight.set(feed.id, pending);
  }
  return pending;
}

const startedMs = (incident: LiveIncident) => (incident.startedAt ? Date.parse(incident.startedAt) : 0);

export async function getLiveSnapshot({
  now = Date.now(),
  feeds = FEEDS,
  server = true,
}: { now?: number; feeds?: Feed[]; server?: boolean } = {}): Promise<LiveSnapshot> {
  const results = await Promise.all(feeds.map(async (feed) => ({ feed, entry: await entryFor(feed, now, server) })));

  const incidents = new Map<string, LiveIncident>();
  const alerts = new Map<string, LiveAlert>();
  const statuses: FeedStatus[] = [];
  for (const { feed, entry } of results) {
    for (const incident of entry.result.incidents) incidents.set(incident.id, incident);
    for (const alert of entry.result.alerts) alerts.set(alert.id, alert);
    statuses.push({
      id: feed.id,
      name: feed.name,
      ok: entry.error === null,
      fetchedAt: entry.okAt !== null ? new Date(entry.okAt).toISOString() : null,
      error: entry.error,
      count: entry.result.incidents.length + entry.result.alerts.length,
    });
  }

  return {
    generatedAt: new Date(now).toISOString(),
    incidents: [...incidents.values()].sort((a, b) => startedMs(b) - startedMs(a)),
    alerts: [...alerts.values()],
    feeds: statuses,
  };
}

/** Tests only. */
export function resetLiveCache() {
  entries.clear();
  inflight.clear();
}

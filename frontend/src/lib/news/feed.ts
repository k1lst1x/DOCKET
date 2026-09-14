import { fallbackIssueMarkers } from "../issue-fallback";
import { listIssueMarkers } from "../issues";
import { getLiveSnapshot } from "../live/snapshot";
import type { GroupDetail } from "../types";
import { incidentNearBoundary } from "./near";
import {
  aboutElsewhere,
  classifyNews,
  DISTRICT_ALIASES,
  isLocalSource,
  isPromotional,
  mentionsFremontArea,
  mentionsNeighborhood,
  parseFeed,
  titleKey,
  type RawEntry,
} from "./parse";
import type { NewsItem, NewsSnapshot, NewsSourceStatus } from "./types";

// Server-side news for a neighborhood group. Each source is cached on its own interval (shared by
// every group that uses it), so the page can poll every minute without hammering publishers.

interface SourceSpec {
  key: string;
  name: string;
  url: string;
  ttlMs: number;
  kind: NewsItem["kind"];
  /**
   * local: a neighborhood search; keep stories that mention Fremont or come from a Bay Area outlet.
   * fremont: must mention Fremont (or a Fremont-only place) in the headline or summary.
   * neighborhood: must name the neighborhood.
   */
  keep: "local" | "fremont" | "neighborhood";
}

const MINUTE = 60_000;
const MAX_AGE_DAYS = 45;
const MAX_ITEMS = 150;
const TIMEOUT_MS = 12_000;
const USER_AGENT = `Mozilla/5.0 (compatible; Docket/1.0; Fremont neighborhood news; ${process.env.APP_URL ?? "https://github.com/k1lst1x/DOCKET"})`;

const googleNews = (query: string) => `https://news.google.com/rss/search?${new URLSearchParams({ q: query, hl: "en-US", gl: "US", ceid: "US:en" })}`;

function sourcesFor(group: GroupDetail): SourceSpec[] {
  const aliases = (DISTRICT_ALIASES[group.district] ?? [group.district]).slice(0, 3);
  const neighborhoodQuery = `(${aliases.map((a) => `"${a}"`).join(" OR ")}) Fremont when:30d`;
  return [
    { key: `google-${group.slug}`, name: `Google News: ${group.district}`, url: googleNews(neighborhoodQuery), ttlMs: 10 * MINUTE, kind: "article", keep: "local" },
    {
      key: "google-safety",
      name: "Google News: Fremont police and crime",
      url: googleNews('"Fremont" California (police OR crime OR arrest OR shooting OR robbery OR burglary OR riot OR protest OR "hit-and-run") when:7d'),
      ttlMs: 10 * MINUTE,
      kind: "article",
      keep: "fremont",
    },
    {
      key: "google-disaster",
      name: "Google News: Fremont fires and disasters",
      url: googleNews('"Fremont" California (fire OR earthquake OR flood OR evacuation OR "power outage" OR storm OR wildfire) when:7d'),
      ttlMs: 10 * MINUTE,
      kind: "article",
      keep: "fremont",
    },
    {
      key: "google-housing",
      name: "Google News: Fremont housing and homes",
      url: googleNews('"Fremont" California (housing OR homes OR "real estate" OR apartments OR development) when:14d'),
      ttlMs: 10 * MINUTE,
      kind: "article",
      keep: "fremont",
    },
    {
      key: "google-cityhall",
      name: "Google News: Fremont city hall",
      url: googleNews('"Fremont" California ("city council" OR "planning commission" OR "school board" OR ordinance) when:14d'),
      ttlMs: 10 * MINUTE,
      kind: "article",
      keep: "fremont",
    },
    { key: "tri-city-voice", name: "Tri-City Voice", url: "https://www.tricityvoice.com/feed/", ttlMs: 5 * MINUTE, kind: "article", keep: "fremont" },
    { key: "patch-fremont", name: "Patch Fremont", url: "https://patch.com/feeds/aol/california/fremont", ttlMs: 5 * MINUTE, kind: "article", keep: "fremont" },
    { key: "reddit-fremont", name: "r/Fremont", url: "https://www.reddit.com/r/fremont/new/.rss", ttlMs: 5 * MINUTE, kind: "community", keep: "neighborhood" },
  ];
}

interface Entry {
  checkedAt: number;
  okAt: number | null;
  entries: RawEntry[];
  error: string | null;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

async function refresh(spec: SourceSpec, now: number): Promise<Entry> {
  const previous = cache.get(spec.key);
  let entry: Entry;
  try {
    const res = await fetch(spec.url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    entry = { checkedAt: now, okAt: now, entries: parseFeed(await res.text()), error: null };
  } catch (error) {
    // Keep the last good copy for an hour when a publisher is briefly down.
    const usable = previous?.okAt !== undefined && previous.okAt !== null && now - previous.okAt < 60 * MINUTE;
    entry = { checkedAt: now, okAt: previous?.okAt ?? null, entries: usable ? previous.entries : [], error: error instanceof Error ? error.message : "Unavailable" };
  }
  cache.set(spec.key, entry);
  return entry;
}

function entryFor(spec: SourceSpec, now: number): Promise<Entry> {
  const cached = cache.get(spec.key);
  const ttl = cached?.error ? Math.min(spec.ttlMs, 2 * MINUTE) : spec.ttlMs;
  if (cached && now - cached.checkedAt < ttl) return Promise.resolve(cached);
  let pending = inflight.get(spec.key);
  if (!pending) {
    pending = refresh(spec, now).finally(() => inflight.delete(spec.key));
    inflight.set(spec.key, pending);
  }
  return pending;
}

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function getNewsSnapshot(group: GroupDetail, now = Date.now()): Promise<NewsSnapshot> {
  const specs = sourcesFor(group);
  const [fetched, live, issues] = await Promise.all([
    Promise.all(specs.map(async (spec) => ({ spec, entry: await entryFor(spec, now) }))),
    getLiveSnapshot().catch(() => null),
    listIssueMarkers()
      .then((list) => ({ list, live: true }))
      .catch(() => ({ list: fallbackIssueMarkers(), live: false })),
  ]);

  const oldest = now - MAX_AGE_DAYS * 24 * 60 * MINUTE;
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  const sources: NewsSourceStatus[] = [];
  for (const { spec, entry } of fetched) {
    let count = 0;
    for (const raw of entry.entries) {
      const text = `${raw.title} ${raw.snippet ?? ""}`;
      if (aboutElsewhere(`${text} ${raw.source ?? ""}`, group.district) || isPromotional(raw.source, raw.title)) continue;
      if (raw.publishedAt && Date.parse(raw.publishedAt) < oldest) continue;
      const inNeighborhood = mentionsNeighborhood(text, group.district);
      const fremont = mentionsFremontArea(text);
      if (spec.keep === "neighborhood" && !inNeighborhood) continue;
      if (spec.keep === "fremont" && !fremont) continue;
      if (spec.keep === "local" && !fremont && !isLocalSource(raw.source ?? spec.name)) continue;
      const key = titleKey(raw.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      count++;
      items.push({
        id: `${spec.key}:${raw.id}`.slice(0, 300),
        title: raw.title,
        url: raw.url,
        source: raw.source ?? spec.name.replace(/^Google News: .*$/, "Google News"),
        publishedAt: raw.publishedAt,
        snippet: raw.snippet,
        category: classifyNews(text),
        inNeighborhood,
        kind: spec.kind,
      });
    }
    sources.push({
      key: spec.key,
      name: spec.name,
      ok: entry.error === null,
      count,
      fetchedAt: entry.okAt ? new Date(entry.okAt).toISOString() : null,
      error: entry.error,
    });
  }
  items.sort((a, b) => (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0));

  const district = slugOf(group.district);
  return {
    generatedAt: new Date(now).toISOString(),
    group: { slug: group.slug, name: group.name, district: group.district },
    items: items.slice(0, MAX_ITEMS),
    incidents: (live?.incidents ?? []).filter((i) => incidentNearBoundary(i, group.boundary)),
    alerts: live?.alerts ?? [],
    issues: issues.list.filter((i) => i.group?.slug === group.slug || i.neighborhoods.includes(district)),
    issuesLive: issues.live,
    sources,
  };
}

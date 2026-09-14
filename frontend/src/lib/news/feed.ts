import { getLiveSnapshot } from "../live/snapshot";
import { incidentToNewsItem, newsworthyIncident } from "./incidents";
import {
  aboutAnotherFremont,
  aboutElsewhere,
  classifyNews,
  DISTRICT_ALIASES,
  isLocalSource,
  isPromotional,
  mentionsFremontArea,
  neighborhoodsMentioned,
  parseFeed,
  titleKey,
  type RawEntry,
} from "./parse";
import type { NewsCatalog, NewsItem, NewsSourceStatus } from "./types";

// Server-side news catalog for all of Fremont. Each source is cached on its own interval, so the
// news page can poll every minute without hammering publishers.

interface SourceSpec {
  key: string;
  name: string;
  url: string;
  ttlMs: number;
  kind: "article" | "community";
  /**
   * local: a neighborhood search; keep stories that mention Fremont or come from a Bay Area outlet.
   * fremont: must mention Fremont (or a Fremont-only place, or a neighborhood) in the headline or summary.
   * community: r/Fremont; keep posts that name a neighborhood or are about more than everyday chatter.
   */
  keep: "local" | "fremont" | "community";
  /** The neighborhood a "local" search is for. */
  district?: string;
}

const MINUTE = 60_000;
const MAX_AGE_DAYS = 180;
const MAX_ITEMS = 600;
const TIMEOUT_MS = 12_000;
const USER_AGENT = `Mozilla/5.0 (compatible; Docket/1.0; Fremont neighborhood news; ${process.env.APP_URL ?? "https://github.com/k1lst1x/DOCKET"})`;

/** All 32 Fremont neighborhoods, alphabetically. */
const DISTRICTS = Object.keys(DISTRICT_ALIASES);
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const googleNews = (query: string) => `https://news.google.com/rss/search?${new URLSearchParams({ q: query, hl: "en-US", gl: "US", ceid: "US:en" })}`;

/** A Google News search for Fremont stories on one topic. */
const topic = (key: string, name: string, query: string, ttlMs = 15 * MINUTE): SourceSpec => ({
  key: `google-${key}`,
  name: `Google News: ${name}`,
  url: googleNews(query),
  ttlMs,
  kind: "article",
  keep: "fremont",
});

/** A Bay Area outlet's own feed; only its stories about Fremont or a neighborhood are kept. */
const outlet = (key: string, name: string, url: string, ttlMs = 5 * MINUTE): SourceSpec => ({ key, name, url, ttlMs, kind: "article", keep: "fremont" });

const SOURCES: SourceSpec[] = [
  // Six months of news per neighborhood. Refreshes are staggered 20 seconds apart so the 32 searches
  // don't all go out on the same poll.
  ...DISTRICTS.map<SourceSpec>((district, index) => ({
    key: `google-${slugOf(district)}`,
    name: `Google News: ${district}`,
    url: googleNews(`(${DISTRICT_ALIASES[district].slice(0, 3).map((a) => `"${a}"`).join(" OR ")}) Fremont when:180d`),
    ttlMs: 30 * MINUTE + index * 20_000,
    kind: "article",
    keep: "local",
    district,
  })),
  topic(
    "safety",
    "Fremont police and crime",
    '"Fremont" California (police OR crime OR arrest OR shooting OR robbery OR burglary OR riot OR protest OR "hit-and-run") when:14d',
    10 * MINUTE,
  ),
  topic("disaster", "Fremont fires and disasters", '"Fremont" California (fire OR earthquake OR flood OR evacuation OR "power outage" OR storm OR wildfire) when:14d', 10 * MINUTE),
  topic("emergency", "Fremont police and fire departments", '"Fremont" ("Fremont Police Department" OR "Fremont Fire Department" OR "Alameda County Fire") when:30d', 10 * MINUTE),
  topic("housing", "Fremont housing and homes", '"Fremont" California (housing OR homes OR "real estate" OR apartments OR development) when:30d'),
  topic("cityhall", "Fremont city hall", '"Fremont" California ("city council" OR "planning commission" OR "school board" OR ordinance) when:30d'),
  topic("schools", "Fremont schools", '"Fremont" California ("Fremont Unified" OR FUSD OR schools OR students OR teachers) when:30d'),
  topic("transportation", "Fremont transportation", '"Fremont" California (BART OR traffic OR road OR freeway OR "I-880" OR "I-680" OR transit OR "bike lane") when:30d'),
  topic("business", "Fremont business", '"Fremont" California (business OR opening OR opens OR restaurant OR store OR closing) when:30d'),
  topic("bay-area-papers", "Fremont in Bay Area papers", "Fremont (site:eastbaytimes.com OR site:mercurynews.com OR site:sfchronicle.com OR site:kqed.org) when:60d"),
  topic("fremont", "Fremont", '"Fremont, CA" OR "Fremont, Calif" when:7d', 10 * MINUTE),
  outlet("tri-city-voice", "Tri-City Voice", "https://www.tricityvoice.com/feed/"),
  outlet("patch-fremont", "Patch Fremont", "https://patch.com/feeds/aol/california/fremont"),
  outlet("ktvu", "KTVU", "https://www.ktvu.com/rss/category/news"),
  outlet("nbc-bay-area", "NBC Bay Area", "https://www.nbcbayarea.com/?rss=y"),
  outlet("cbs-san-francisco", "CBS San Francisco", "https://www.cbsnews.com/sanfrancisco/latest/rss/main"),
  outlet("sfgate-bay-area", "SFGATE", "https://www.sfgate.com/bayarea/feed/Bay-Area-News-429.php", 10 * MINUTE),
  outlet("abc7", "ABC7 News", "https://abc7news.com/feed/"),
  { key: "reddit-fremont", name: "r/Fremont", url: "https://www.reddit.com/r/fremont/new/.rss", ttlMs: 5 * MINUTE, kind: "community", keep: "community" },
];

interface Entry {
  checkedAt: number;
  okAt: number | null;
  entries: RawEntry[];
  error: string | null;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

// A cold server would otherwise send all ~50 requests at once, and Google News throttles bursts.
const MAX_CONCURRENT_FETCHES = 10;
let activeFetches = 0;
const waiting: (() => void)[] = [];

async function withFetchSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeFetches >= MAX_CONCURRENT_FETCHES) await new Promise<void>((resolve) => waiting.push(resolve));
  activeFetches++;
  try {
    return await work();
  } finally {
    activeFetches--;
    waiting.shift()?.();
  }
}

async function refresh(spec: SourceSpec, now: number): Promise<Entry> {
  const previous = cache.get(spec.key);
  let entry: Entry;
  try {
    const xml = await withFetchSlot(async () => {
      const res = await fetch(spec.url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
    entry = { checkedAt: now, okAt: now, entries: parseFeed(xml), error: null };
  } catch (error) {
    // Keep the last good copy for an hour when a publisher is briefly down.
    const okAt = previous?.okAt ?? null;
    const usable = okAt !== null && now - okAt < 60 * MINUTE;
    entry = { checkedAt: now, okAt, entries: usable && previous ? previous.entries : [], error: error instanceof Error ? error.message : "Unavailable" };
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

const publishedMs = (item: NewsItem) => (item.publishedAt ? Date.parse(item.publishedAt) : 0);

export async function getNewsCatalog(now = Date.now()): Promise<NewsCatalog> {
  const [fetched, live] = await Promise.all([
    Promise.all(SOURCES.map(async (spec) => ({ spec, entry: await entryFor(spec, now) }))),
    getLiveSnapshot().catch(() => null),
  ]);

  const oldest = now - MAX_AGE_DAYS * 24 * 60 * MINUTE;
  const byTitle = new Map<string, NewsItem>();
  const sources: NewsSourceStatus[] = [];
  for (const { spec, entry } of fetched) {
    let count = 0;
    for (const raw of entry.entries) {
      const text = `${raw.title} ${raw.snippet ?? ""}`;
      if (aboutAnotherFremont(`${text} ${raw.source ?? ""}`) || isPromotional(raw.source, raw.title)) continue;
      if (spec.district && aboutElsewhere(text, spec.district)) continue;
      if (raw.publishedAt && Date.parse(raw.publishedAt) < oldest) continue;

      const neighborhoods = neighborhoodsMentioned(text);
      // Google matched the neighborhood somewhere in the story, even if not in the headline.
      if (spec.district && !neighborhoods.includes(spec.district)) neighborhoods.push(spec.district);
      const fremont = mentionsFremontArea(text);
      const category = classifyNews(text);
      if (spec.keep === "fremont" && !fremont && neighborhoods.length === 0) continue;
      if (spec.keep === "local" && !fremont && !isLocalSource(raw.source ?? spec.name)) continue;
      if (spec.keep === "community" && neighborhoods.length === 0 && category === "community") continue;

      const key = titleKey(raw.title);
      if (!key) continue;
      const existing = byTitle.get(key);
      if (existing) {
        for (const n of neighborhoods) if (!existing.neighborhoods.includes(n)) existing.neighborhoods.push(n);
        continue;
      }
      count++;
      byTitle.set(key, {
        id: `${spec.key}:${raw.id}`.slice(0, 300),
        title: raw.title,
        url: raw.url,
        source: raw.source ?? (spec.kind === "community" ? spec.name : spec.name.replace(/^Google News: .*$/, "Google News")),
        publishedAt: raw.publishedAt,
        snippet: raw.snippet,
        category,
        neighborhoods,
        kind: spec.kind,
        severity: null,
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

  const incidents = (live?.incidents ?? []).filter(newsworthyIncident).map(incidentToNewsItem);
  const items = [...byTitle.values(), ...incidents].sort((a, b) => publishedMs(b) - publishedMs(a)).slice(0, MAX_ITEMS);

  return {
    generatedAt: new Date(now).toISOString(),
    items,
    alerts: live?.alerts ?? [],
    neighborhoods: DISTRICTS,
    sources,
  };
}

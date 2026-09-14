import { DISTRICT_ALIASES } from "./parse";
import type { NewsCategory, NewsItem, NewsKind } from "./types";

// Searching, filtering and sorting the news catalog. Pure, so it runs in the browser on every
// keystroke and is easy to test.

/** "news" (the default) lists articles, then community posts, then live incidents, each newest first. */
export type NewsSort = "news" | "newest" | "oldest" | "relevance";
export type NewsRange = "day" | "week" | "month" | "all";

export interface NewsQuery {
  q: string;
  /** "all", "fremont-wide" (items naming no neighborhood), or a neighborhood slug. */
  area: string;
  /** Empty means every category. */
  categories: NewsCategory[];
  /** Empty means every kind. */
  kinds: NewsKind[];
  /** "all" or a source name. */
  source: string;
  range: NewsRange;
  sort: NewsSort;
}

export const DEFAULT_NEWS_QUERY: NewsQuery = { q: "", area: "all", categories: [], kinds: [], source: "all", range: "all", sort: "news" };

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_MS: Record<NewsRange, number> = { day: DAY_MS, week: 7 * DAY_MS, month: 31 * DAY_MS, all: Infinity };
const KIND_RANK: Record<NewsKind, number> = { article: 0, community: 1, incident: 2 };

export const areaSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The news page for a neighborhood: its filter when news is tagged by that area (the five historic
 * districts), otherwise a search for the neighborhood's name.
 */
export const newsHrefFor = (neighborhoodName: string) =>
  neighborhoodName in DISTRICT_ALIASES ? `/news?area=${areaSlug(neighborhoodName)}` : `/news?q=${encodeURIComponent(neighborhoodName)}`;

/** True when a story is tagged with the neighborhood or names it in its headline or summary. */
export function aboutNeighborhood(item: NewsItem, neighborhoodName: string): boolean {
  if (item.neighborhoods.includes(neighborhoodName)) return true;
  const escaped = neighborhoodName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z])${escaped}([^A-Za-z]|$)`, "i").test(`${item.title} ${item.snippet ?? ""}`);
}
const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export function searchTerms(q: string): string[] {
  return [...new Set(fold(q).split(/[^a-z0-9]+/).filter((t) => t.length > 1))];
}

/** Search relevance: every term must appear; headline matches count three times as much. */
export function relevance(item: NewsItem, terms: string[]): number {
  if (!terms.length) return 0;
  const title = fold(item.title);
  const rest = fold(`${item.snippet ?? ""} ${item.source} ${item.neighborhoods.join(" ")}`);
  let score = 0;
  for (const term of terms) {
    const inTitle = title.includes(term);
    const inRest = rest.includes(term);
    if (!inTitle && !inRest) return -1;
    score += (inTitle ? 3 : 0) + (inRest ? 1 : 0);
  }
  return score;
}

const publishedMs = (item: NewsItem) => (item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN);

export function filterNews(items: NewsItem[], query: NewsQuery, now: number): NewsItem[] {
  const terms = searchTerms(query.q);
  const maxAge = RANGE_MS[query.range];
  const scored: { item: NewsItem; score: number }[] = [];
  for (const item of items) {
    if (query.area === "fremont-wide" ? item.neighborhoods.length > 0 : query.area !== "all" && !item.neighborhoods.some((n) => areaSlug(n) === query.area)) continue;
    if (query.categories.length && !query.categories.includes(item.category)) continue;
    if (query.kinds.length && !query.kinds.includes(item.kind)) continue;
    if (query.source !== "all" && item.source !== query.source) continue;
    if (maxAge !== Infinity) {
      const t = publishedMs(item);
      if (!Number.isFinite(t) || now - t > maxAge) continue;
    }
    const score = relevance(item, terms);
    if (score < 0) continue;
    scored.push({ item, score });
  }
  const byDate = (a: NewsItem, b: NewsItem) => (publishedMs(b) || 0) - (publishedMs(a) || 0);
  scored.sort((a, b) => {
    if (query.sort === "oldest") return (publishedMs(a.item) || 0) - (publishedMs(b.item) || 0);
    if (query.sort === "relevance" && terms.length && b.score !== a.score) return b.score - a.score;
    if (query.sort === "news" && a.item.kind !== b.item.kind) return KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind];
    return byDate(a.item, b.item);
  });
  return scored.map((s) => s.item);
}

/** The query as URL parameters (defaults omitted), so filtered views can be shared. */
export function queryToParams(query: NewsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.area !== "all") params.set("area", query.area);
  if (query.categories.length) params.set("cat", query.categories.join(","));
  if (query.kinds.length) params.set("type", query.kinds.join(","));
  if (query.source !== "all") params.set("source", query.source);
  if (query.range !== "all") params.set("range", query.range);
  if (query.sort !== DEFAULT_NEWS_QUERY.sort) params.set("sort", query.sort);
  return params;
}

export function paramsToQuery(params: URLSearchParams, allowed: { categories: string[]; kinds: string[] }): NewsQuery {
  const list = <T extends string>(key: "cat" | "type", valid: string[]) =>
    (params.get(key) ?? "")
      .split(",")
      .filter((v) => valid.includes(v)) as T[];
  const range = params.get("range");
  const sort = params.get("sort");
  return {
    q: (params.get("q") ?? "").slice(0, 120),
    area: /^[a-z0-9-]{1,60}$/.test(params.get("area") ?? "") ? (params.get("area") as string) : "all",
    categories: list<NewsCategory>("cat", allowed.categories),
    kinds: list<NewsKind>("type", allowed.kinds),
    source: (params.get("source") ?? "all").slice(0, 80) || "all",
    range: range === "day" || range === "week" || range === "month" ? range : "all",
    sort: sort === "newest" || sort === "oldest" || sort === "relevance" ? sort : DEFAULT_NEWS_QUERY.sort,
  };
}

import { describe, expect, it } from "vitest";
import { aboutNeighborhood, DEFAULT_NEWS_QUERY, filterNews, newsHrefFor, paramsToQuery, queryToParams, relevance, searchTerms, type NewsQuery } from "./filter";
import type { NewsItem } from "./types";

const NOW = Date.parse("2026-09-13T22:00:00Z");
const HOUR = 3_600_000;

const item = (id: string, overrides: Partial<NewsItem>): NewsItem => ({
  id,
  title: id,
  url: `https://example.com/${id}`,
  source: "Tri City Voice",
  publishedAt: new Date(NOW - HOUR).toISOString(),
  snippet: null,
  category: "community",
  neighborhoods: [],
  kind: "article",
  severity: null,
  ...overrides,
});

const ITEMS: NewsItem[] = [
  item("niles-faire", { title: "Niles holds Antique Faire", neighborhoods: ["Niles"], publishedAt: new Date(NOW - 5 * 24 * HOUR).toISOString() }),
  item("irvington-arrest", { title: "Police arrest burglary suspect in Irvington", category: "safety", neighborhoods: ["Irvington"], source: "East Bay Times" }),
  item("fremont-fire", { title: "Grass fire near I-680", category: "disaster", publishedAt: new Date(NOW - 2 * HOUR).toISOString() }),
  item("chp", { title: "Collision, no injuries", category: "traffic", kind: "incident", source: "CHP", neighborhoods: ["Warm Springs"], publishedAt: new Date(NOW - 10 * 60_000).toISOString() }),
  item("reddit", { title: "Loud booms near Niles Canyon?", kind: "community", source: "r/Fremont", neighborhoods: ["Niles"], snippet: "Anyone hear the fireworks?", publishedAt: null }),
];

const run = (overrides: Partial<NewsQuery>) => filterNews(ITEMS, { ...DEFAULT_NEWS_QUERY, ...overrides }, NOW).map((i) => i.id);

describe("filterNews", () => {
  it("lists articles first by default, then community posts, then live incidents, each newest first", () => {
    expect(run({})).toEqual(["irvington-arrest", "fremont-fire", "niles-faire", "reddit", "chp"]);
  });

  it("can mix every kind newest first, undated items last", () => {
    expect(run({ sort: "newest" })).toEqual(["chp", "irvington-arrest", "fremont-fire", "niles-faire", "reddit"]);
  });

  it("filters by neighborhood, Fremont-wide, category, kind and source", () => {
    expect(run({ area: "niles" })).toEqual(["niles-faire", "reddit"]);
    expect(run({ area: "warm-springs" })).toEqual(["chp"]);
    expect(run({ area: "fremont-wide" })).toEqual(["fremont-fire"]);
    expect(run({ categories: ["safety", "disaster"] })).toEqual(["irvington-arrest", "fremont-fire"]);
    expect(run({ kinds: ["incident", "community"] })).toEqual(["reddit", "chp"]);
    expect(run({ kinds: ["incident"] })).toEqual(["chp"]);
    expect(run({ source: "East Bay Times" })).toEqual(["irvington-arrest"]);
  });

  it("limits to a time range and drops undated items from it", () => {
    expect(run({ range: "day" })).toEqual(["irvington-arrest", "fremont-fire", "chp"]);
    expect(run({ range: "week" })).toEqual(["irvington-arrest", "fremont-fire", "niles-faire", "chp"]);
  });

  it("searches headlines, summaries, sources and neighborhoods, and sorts by relevance or date", () => {
    expect(run({ q: "niles" })).toEqual(["niles-faire", "reddit"]);
    expect(run({ q: "fireworks booms" })).toEqual(["reddit"]);
    expect(run({ q: "east bay" })).toEqual(["irvington-arrest"]);
    expect(run({ q: "fire" })).toEqual(["fremont-fire", "reddit"]);
    expect(run({ q: "fire", sort: "relevance" })[0]).toBe("fremont-fire");
    expect(run({ sort: "oldest" })).toEqual(["reddit", "niles-faire", "fremont-fire", "irvington-arrest", "chp"]);
  });

  it("scores headline matches above summary matches", () => {
    expect(searchTerms("  Niles,  Canyon! a ")).toEqual(["niles", "canyon"]);
    const booms = ITEMS[4];
    expect(relevance(booms, ["booms"])).toBe(3);
    expect(relevance(booms, ["fireworks"])).toBe(1);
    expect(relevance(booms, ["missing"])).toBe(-1);
  });
});

describe("neighborhood news", () => {
  it("links districts to their filter and other neighborhoods to a name search", () => {
    expect(newsHrefFor("Mission San Jose")).toBe("/news?area=mission-san-jose");
    expect(newsHrefFor("Kimber/Gomes")).toBe("/news?q=Kimber%2FGomes");
  });

  it("matches stories tagged with a neighborhood or naming it", () => {
    expect(aboutNeighborhood(ITEMS[0], "Niles")).toBe(true);
    expect(aboutNeighborhood(item("w", { title: "Weibel school fundraiser" }), "Weibel")).toBe(true);
    expect(aboutNeighborhood(item("w2", { title: "Weibelstrasse in Berlin" }), "Weibel")).toBe(false);
    expect(aboutNeighborhood(item("g", { title: "Council meets", snippet: "Glenmoor residents asked for a crosswalk." }), "Glenmoor")).toBe(true);
    expect(aboutNeighborhood(item("x", { title: "BART delays" }), "Weibel")).toBe(false);
  });
});

describe("URL parameters", () => {
  it("round-trips a query and ignores invalid values", () => {
    const query: NewsQuery = { q: "bart", area: "irvington", categories: ["traffic", "safety"], kinds: ["incident"], source: "CHP", range: "week", sort: "relevance" };
    const params = queryToParams(query);
    expect(params.toString()).toBe("q=bart&area=irvington&cat=traffic%2Csafety&type=incident&source=CHP&range=week&sort=relevance");
    const allowed = { categories: ["traffic", "safety"], kinds: ["incident"] };
    expect(paramsToQuery(params, allowed)).toEqual(query);
    expect(paramsToQuery(new URLSearchParams("area=<script>&cat=bogus&range=year&sort=random"), allowed)).toEqual(DEFAULT_NEWS_QUERY);
    expect(queryToParams(DEFAULT_NEWS_QUERY).toString()).toBe("");
    expect(queryToParams({ ...DEFAULT_NEWS_QUERY, sort: "newest" }).toString()).toBe("sort=newest");
    expect(paramsToQuery(new URLSearchParams("sort=newest"), allowed).sort).toBe("newest");
  });
});

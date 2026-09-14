"use client";

import { useEffect, useMemo, useState } from "react";
import { useChatContext } from "@/components/chat/chat-context-store";
import { timeAgo } from "@/components/places/LivePanel";
import { areaSlug, DEFAULT_NEWS_QUERY, filterNews, paramsToQuery, queryToParams, type NewsQuery, type NewsRange, type NewsSort } from "@/lib/news/filter";
import { alertToNewsItem } from "@/lib/news/incidents";
import { DISTRICT_ALIASES } from "@/lib/news/parse";
import { NEWS_CATEGORIES, NEWS_KINDS, newsCategoryInfo, type NewsCategory, type NewsItem, type NewsKind } from "@/lib/news/types";
import { readableAccent } from "@/lib/theme";
import { NewsDialog } from "./NewsDialog";
import { useNewsCatalog } from "./useNewsCatalog";

// The Fremont news page: one list of stories, community posts and live incidents that can be
// searched, filtered and sorted. News articles come first by default; live incidents follow and
// can be brought forward with the sort or the type filter. Every item opens in its own popup.
// It refreshes every minute; stories that arrive while you read are marked "New". Filters live in
// the URL so a view can be shared.

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 200;
const NEIGHBORHOODS = Object.keys(DISTRICT_ALIASES);
const ALLOWED = { categories: NEWS_CATEGORIES.map((c) => c.id), kinds: NEWS_KINDS.map((k) => k.id) };

const SORTS: [NewsSort, string][] = [
  ["news", "News articles first"],
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["relevance", "Most relevant"],
];
const RANGES: [NewsRange, string][] = [
  ["all", "Any time"],
  ["day", "Past 24 hours"],
  ["week", "Past week"],
  ["month", "Past month"],
];

export function NewsCenter() {
  const { catalog, status, preview, lastUpdated, refreshing, newIds, load } = useNewsCatalog();
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState<NewsQuery>(DEFAULT_NEWS_QUERY);
  const [draft, setDraft] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openItem, setOpenItem] = useState<NewsItem | null>(null);

  // Filters from the link.
  useEffect(() => {
    const initial = paramsToQuery(new URLSearchParams(window.location.search), ALLOWED);
    setQuery(initial);
    setDraft(initial.q);
    setHydrated(true);
  }, []);

  // Keep the link in step with the filters.
  useEffect(() => {
    if (!hydrated) return;
    const qs = queryToParams(query).toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    setShown(PAGE_SIZE);
  }, [hydrated, query]);

  // Search as you type, lightly debounced.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery((q) => (q.q === draft ? q : { ...q, q: draft })), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(tick);
  }, []);

  const items = useMemo(() => catalog?.items ?? [], [catalog]);
  const results = useMemo(() => filterNews(items, query, now), [items, query, now]);
  const categoryCounts = useMemo(() => countBy(filterNews(items, { ...query, categories: [] }, now), (i) => i.category), [items, query, now]);
  const kindCounts = useMemo(() => countBy(filterNews(items, { ...query, kinds: [] }, now), (i) => i.kind), [items, query, now]);
  const areaCounts = useMemo(() => {
    const base = filterNews(items, { ...query, area: "all" }, now);
    const counts = new Map<string, number>([["all", base.length], ["fremont-wide", base.filter((i) => !i.neighborhoods.length).length]]);
    for (const name of NEIGHBORHOODS) counts.set(areaSlug(name), base.filter((i) => i.neighborhoods.includes(name)).length);
    return counts;
  }, [items, query, now]);
  const sourceOptions = useMemo(() => {
    const counts = countBy(items, (i) => i.source);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40);
  }, [items]);

  const areaName = query.area === "all" ? "Fremont" : query.area === "fremont-wide" ? "Citywide Fremont" : (NEIGHBORHOODS.find((n) => areaSlug(n) === query.area) ?? "Fremont");
  useChatContext(
    catalog
      ? {
          kind: "news",
          label: "News page",
          title: `${areaName} news${query.q ? ` matching “${query.q}”` : ""}`,
          details: results.slice(0, 6).map((i) => `Headline on screen: ${i.title} (${i.source})`),
        }
      : null,
    1,
  );

  const activeFilters =
    (query.area !== "all" ? 1 : 0) + query.categories.length + query.kinds.length + (query.source !== "all" ? 1 : 0) + (query.range !== "all" ? 1 : 0);
  const seconds = lastUpdated ? Math.max(0, Math.round((now - lastUpdated) / 1000)) : null;
  const update = (patch: Partial<NewsQuery>) => setQuery((q) => ({ ...q, ...patch }));
  const toggle = <T extends string>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const clearAll = () => {
    setDraft("");
    setQuery(DEFAULT_NEWS_QUERY);
  };
  const failing = (catalog?.sources ?? []).filter((s) => !s.ok);

  return (
    <>
      {/* grid-rows auto/1fr: the filter sidebar spans both rows; without it, a short result list lets the sidebar's
          extra height stretch the search row too, leaving a big gap above the results. */}
      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-8">
        {/* min-w-0: grid items otherwise grow to fit the scrolling chip row, widening the page on phones. */}
        <div className="min-w-0 lg:col-start-2">
          <form role="search" onSubmit={(e) => e.preventDefault()} className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 basis-64 items-center gap-2 rounded-full border border-field bg-white px-4 focus-within:border-ink">
              <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted">
                <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <label htmlFor="news-search" className="sr-only">
                Search Fremont news
              </label>
              <input
                id="news-search"
                type="search"
                value={draft}
                maxLength={120}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Search news: BART, Mission Blvd, fire…"
                className="h-12 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-muted focus:outline-none"
              />
            </div>
            <label htmlFor="news-sort" className="sr-only">
              Sort
            </label>
            <select id="news-sort" value={query.sort} onChange={(e) => update({ sort: e.target.value as NewsSort })} className="field h-12 w-auto rounded-full pr-9">
              {SORTS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <button type="button" aria-expanded={filtersOpen} aria-controls="news-filters" onClick={() => setFiltersOpen((o) => !o)} className="btn btn-secondary h-12 rounded-full px-5 lg:hidden">
              Filters{activeFilters ? ` (${activeFilters})` : ""}
            </button>
          </form>

          <div role="group" aria-label="Filter by topic" className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            {NEWS_CATEGORIES.map((c) => (
              <Chip
                key={c.id}
                active={query.categories.includes(c.id)}
                onClick={() => update({ categories: toggle(query.categories, c.id) })}
                label={`${c.icon} ${c.label}`}
                count={categoryCounts.get(c.id) ?? 0}
              />
            ))}
          </div>
        </div>

        <aside id="news-filters" className={`${filtersOpen ? "block" : "hidden"} lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:block`} aria-label="News filters">
          <div className="grid gap-5 rounded-2xl border border-rule bg-white p-5 lg:sticky lg:top-4">
            <fieldset>
              <legend className="text-sm font-semibold text-ink">Neighborhood</legend>
              {/* 32 neighborhoods: scroll inside the list so the sticky sidebar's other filters stay reachable. */}
              <div className="mt-2 grid max-h-80 gap-1 overflow-y-auto overscroll-contain pr-1">
                <Radio name="area" value="all" checked={query.area === "all"} onChange={() => update({ area: "all" })} label="All of Fremont" count={areaCounts.get("all")} />
                {NEIGHBORHOODS.map((name) => (
                  <Radio
                    key={name}
                    name="area"
                    value={areaSlug(name)}
                    checked={query.area === areaSlug(name)}
                    onChange={() => update({ area: areaSlug(name) })}
                    label={name}
                    count={areaCounts.get(areaSlug(name))}
                  />
                ))}
                <Radio name="area" value="fremont-wide" checked={query.area === "fremont-wide"} onChange={() => update({ area: "fremont-wide" })} label="Citywide only" count={areaCounts.get("fremont-wide")} />
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-semibold text-ink">Type</legend>
              <div className="mt-2 grid gap-1">
                {NEWS_KINDS.map((k) => (
                  <label key={k.id} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-sky-mist">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={query.kinds.includes(k.id)} onChange={() => update({ kinds: toggle(query.kinds, k.id) })} className="h-4 w-4 accent-ink" />
                      {k.label}
                    </span>
                    <span className="font-mono text-xs text-ink-muted">{kindCounts.get(k.id) ?? 0}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="news-range" className="text-sm font-semibold text-ink">
                When
              </label>
              <select id="news-range" value={query.range} onChange={(e) => update({ range: e.target.value as NewsRange })} className="field mt-2 h-11 rounded-full pr-9">
                {RANGES.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="news-source" className="text-sm font-semibold text-ink">
                Source
              </label>
              <select id="news-source" value={query.source} onChange={(e) => update({ source: e.target.value })} className="field mt-2 h-11 rounded-full pr-9">
                <option value="all">All sources</option>
                {query.source !== "all" && !sourceOptions.some(([name]) => name === query.source) ? <option value={query.source}>{query.source}</option> : null}
                {sourceOptions.map(([name, count]) => (
                  <option key={name} value={name}>
                    {`${name} (${count})`}
                  </option>
                ))}
              </select>
            </div>

            {activeFilters || query.q || query.sort !== DEFAULT_NEWS_QUERY.sort ? (
              <button type="button" onClick={clearAll} className="btn btn-secondary h-11 rounded-full">
                Clear all filters
              </button>
            ) : null}
          </div>
        </aside>

        <section aria-labelledby="news-results" className="min-w-0 lg:col-start-2">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3">
            <p id="news-results" aria-live="polite" className="text-sm font-semibold text-ink">
              {catalog ? `${results.length} ${results.length === 1 ? "result" : "results"}${query.q ? ` for “${query.q}”` : ""}` : "Loading news…"}
              {catalog && query.sort === "news" && !query.kinds.length ? <span className="font-normal text-ink-muted"> · news articles first, live incidents after</span> : null}
            </p>
            <p className="inline-flex items-center gap-2 text-sm text-ink-soft">
              <span aria-hidden="true" className="relative flex h-2.5 w-2.5">
                {status === "live" ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d93025] opacity-60" /> : null}
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${status === "live" ? "bg-[#d93025]" : "bg-ink-muted"}`} />
              </span>
              {status === "error"
                ? "Unavailable, retrying"
                : status === "loading"
                  ? "Connecting"
                  : `Live · ${seconds !== null && seconds < 10 ? "just now" : seconds !== null && seconds < 60 ? `${seconds}s ago` : timeAgo(lastUpdated ? new Date(lastUpdated).toISOString() : null, now).toLowerCase()}`}
              <button type="button" onClick={() => void load()} disabled={refreshing} className="link ml-1 disabled:opacity-60">
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </p>
          </div>

          {catalog?.alerts.length ? (
            <ul aria-label="Alerts for Fremont" className="mt-3 grid gap-2">
              {catalog.alerts.map((alert) => (
                <li key={alert.id}>
                  <button
                    type="button"
                    onClick={() => setOpenItem(alertToNewsItem(alert))}
                    className={`w-full rounded-2xl border p-4 text-left ${alert.severity === "Extreme" || alert.severity === "Severe" ? "border-signal bg-signal-wash text-signal" : "border-ochre bg-ochre-wash text-ochre"}`}
                  >
                    <span className="block font-semibold">⚠️ {alert.event}</span>
                    {alert.headline ? <span className="mt-1 block text-sm">{alert.headline}</span> : null}
                    <span className="mt-1 block text-sm font-semibold underline">Read the alert</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {preview ? (
            <p className="mt-3 rounded-2xl bg-white p-4 text-base text-ink-soft">
              News articles load on the full Docket site. This preview lists live incidents and alerts.
            </p>
          ) : null}

          {status === "loading" && !catalog ? (
            <ul aria-hidden="true" className="mt-3 grid gap-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="h-28 animate-pulse rounded-2xl bg-white" />
              ))}
            </ul>
          ) : null}

          {catalog && results.length === 0 ? (
            <div className="mt-3 rounded-2xl bg-white p-6 text-center">
              <p className="text-lg font-semibold text-ink">No news matches these filters.</p>
              <button type="button" onClick={clearAll} className="btn btn-secondary mt-4 h-11 rounded-full px-5">
                Clear all filters
              </button>
            </div>
          ) : null}

          {results.length ? (
            <ul className="mt-3 grid gap-3">
              {results.slice(0, shown).map((item, index) => (
                <Story
                  key={item.id}
                  item={item}
                  isNew={newIds.has(item.id)}
                  now={now}
                  firstIncident={query.sort === "news" && item.kind === "incident" && index > 0 && results[index - 1].kind !== "incident"}
                  onOpen={setOpenItem}
                  onArea={(name) => update({ area: areaSlug(name) })}
                />
              ))}
            </ul>
          ) : null}
          {results.length > shown ? (
            <button type="button" onClick={() => setShown((n) => n + PAGE_SIZE)} className="btn btn-secondary mt-4 h-11 w-full rounded-full sm:w-auto sm:px-6">
              Show more ({results.length - shown})
            </button>
          ) : null}

          <p className="mt-6 text-sm text-ink-muted">
            From Google News searches for all 32 neighborhoods, Tri-City Voice, Patch Fremont, KTVU, NBC Bay Area, CBS San Francisco, SFGATE,
            ABC7 and r/Fremont, plus resident reports from the Fremont App, CHP, Caltrans, CAL FIRE, USGS, BART, the National Weather Service
            and California&apos;s outage map. Fremont Police and Fire don&apos;t publish live incident feeds; for police alerts follow{" "}
            <a href="https://local.nixle.com/fremont-police-department-ca/" target="_blank" rel="noopener noreferrer" className="underline">
              Fremont PD on Nixle
            </a>
            .{failing.length ? ` ${failing.length === 1 ? `${failing[0].name} isn't` : `${failing.length} sources aren't`} responding; showing the latest copy.` : ""}
          </p>
        </section>
      </div>

      <NewsDialog
        item={openItem}
        onClose={() => setOpenItem(null)}
        pool={results}
        onOpenItem={setOpenItem}
        onArea={(name) => {
          update({ area: areaSlug(name) });
          setOpenItem(null);
        }}
      />
    </>
  );
}

function countBy<T>(items: NewsItem[], key: (item: NewsItem) => T): Map<T, number> {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function Chip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${
        active ? "border-ink bg-ink text-white" : "border-rule bg-white text-ink hover:border-ink/40"
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 font-mono text-xs ${active ? "bg-white/20" : "bg-sky-mist"}`}>{count}</span>
    </button>
  );
}

function Radio({ name, value, checked, onChange, label, count }: { name: string; value: string; checked: boolean; onChange: () => void; label: string; count?: number }) {
  return (
    <label className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm ${checked ? "bg-sky-mist font-semibold text-ink" : "text-ink hover:bg-sky-mist"}`}>
      <span className="flex items-center gap-2">
        <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="h-4 w-4 accent-ink" />
        {label}
      </span>
      <span className="font-mono text-xs text-ink-muted">{count ?? 0}</span>
    </label>
  );
}

interface StoryProps {
  item: NewsItem;
  isNew: boolean;
  now: number;
  /** The first live incident after the news, which gets a small heading. */
  firstIncident: boolean;
  onOpen: (item: NewsItem) => void;
  onArea: (name: string) => void;
}

function Story({ item, isNew, now, firstIncident, onOpen, onArea }: StoryProps) {
  const info = newsCategoryInfo(item.category as NewsCategory);
  const kind: NewsKind = item.kind;
  return (
    <li>
      {firstIncident ? <h2 className="mb-3 mt-3 text-sm font-semibold text-ink-soft">Live incidents</h2> : null}
      {/* The headline button stretches over the whole card; neighborhood chips sit above it. */}
      <article className="relative rounded-2xl border border-rule bg-white p-4 transition-colors hover:border-ink/30 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: `${info.color}14`, color: readableAccent(info.color) }}>
            <span aria-hidden="true">{info.icon} </span>
            {info.label}
          </span>
          {kind === "incident" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-signal-wash px-2 py-0.5 text-xs font-semibold text-signal">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-signal" />
              Live incident{item.severity === "severe" ? " · serious" : ""}
            </span>
          ) : null}
          {kind === "community" ? <span className="rounded-full bg-sky-mist px-2 py-0.5 text-xs font-semibold text-ink-soft">Community post</span> : null}
          {item.neighborhoods.map((name) => (
            <button key={name} type="button" onClick={() => onArea(name)} className="relative z-10 rounded-full bg-park-wash px-2 py-0.5 text-xs font-semibold text-park hover:underline">
              {name}
            </button>
          ))}
          {isNew ? <span className="rounded-full bg-signal px-2 py-0.5 text-xs font-semibold text-white">New</span> : null}
          <span className="text-ink-muted">
            {item.source} · {item.publishedAt ? <time dateTime={item.publishedAt}>{timeAgo(item.publishedAt, now)}</time> : "Date unknown"}
          </span>
        </div>
        <h3 className="mt-2 text-lg font-semibold leading-snug text-ink">
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => onOpen(item)}
            className="text-left after:absolute after:inset-0 after:rounded-2xl hover:underline hover:underline-offset-4"
          >
            {item.title}
          </button>
        </h3>
        {item.snippet ? <p className="mt-1 line-clamp-3 text-base text-ink-soft">{item.snippet}</p> : null}
      </article>
    </li>
  );
}

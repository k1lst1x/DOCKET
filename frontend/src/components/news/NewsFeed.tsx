"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { issueStatus } from "@/components/places/IssuesPanel";
import { timeAgo } from "@/components/places/LivePanel";
import { fallbackIssueMarkers } from "@/lib/issue-fallback";
import { FEEDS } from "@/lib/live/feeds";
import { getLiveSnapshot } from "@/lib/live/snapshot";
import { liveKindInfo } from "@/lib/live/types";
import { incidentNearBoundary } from "@/lib/news/near";
import { NEWS_CATEGORIES, newsCategoryInfo, type NewsCategory, type NewsItem, type NewsSnapshot } from "@/lib/news/types";
import type { LngLat } from "@/lib/types";

// Neighborhood news, refreshed every minute while the page is open. New stories that arrive after
// you opened the page are marked "New". The static preview has no API, so it shows the live feeds
// browsers can reach directly (earthquakes, weather alerts, outages) and the saved city issues.

const POLL_MS = 60_000;
const PAGE_SIZE = 12;

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

interface NewsFeedProps {
  slug: string;
  district: string;
  boundary: LngLat[];
}

export function NewsFeed({ slug, district, boundary }: NewsFeedProps) {
  const [snapshot, setSnapshot] = useState<NewsSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [preview, setPreview] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState<NewsCategory | "all">("all");
  const [now, setNow] = useState(() => Date.now());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const known = useRef<Set<string> | null>(null);
  const busy = useRef(false);
  const staticSite = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      let next: NewsSnapshot | null = null;
      if (!staticSite.current) {
        const res = await fetch(`/api/groups/${encodeURIComponent(slug)}/news`, { cache: "no-store" });
        if (res.ok) next = (await res.json()) as NewsSnapshot;
        else if (res.status === 404) staticSite.current = true;
        else throw new Error(`HTTP ${res.status}`);
      }
      if (!next && staticSite.current) {
        const live = await getLiveSnapshot({ feeds: FEEDS.filter((f) => f.browser), server: false }).catch(() => null);
        const hood = slugOf(district);
        next = {
          generatedAt: new Date().toISOString(),
          group: { slug, name: "", district },
          items: [],
          incidents: (live?.incidents ?? []).filter((i) => incidentNearBoundary(i, boundary)),
          alerts: live?.alerts ?? [],
          issues: fallbackIssueMarkers().filter((i) => i.group?.slug === slug || i.neighborhoods.includes(hood)),
          issuesLive: false,
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
      setSnapshot(next);
      setStatus("live");
      setLastUpdated(Date.now());
    } catch {
      setStatus((s) => (s === "live" ? "live" : "error"));
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  }, [slug, district, boundary]);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    const onReturn = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [load]);

  const items = snapshot?.items ?? [];
  const filtered = category === "all" ? items : items.filter((i) => i.category === category);
  const local = filtered.filter((i) => i.inNeighborhood);
  const around = filtered.filter((i) => !i.inNeighborhood);
  const seconds = lastUpdated ? Math.max(0, Math.round((now - lastUpdated) / 1000)) : null;
  const failing = (snapshot?.sources ?? []).filter((s) => !s.ok);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
      <section aria-labelledby="news-heading" className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3">
          <p aria-live="polite" className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <span aria-hidden="true" className="relative flex h-2.5 w-2.5">
              {status === "live" ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d93025] opacity-60" /> : null}
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${status === "live" ? "bg-[#d93025]" : "bg-ink-muted"}`} />
            </span>
            {status === "loading"
              ? "Gathering the latest news…"
              : status === "error"
                ? "News is unavailable right now. Retrying every minute."
                : `Live · updated ${seconds !== null && seconds < 10 ? "just now" : seconds !== null && seconds < 60 ? `${seconds}s ago` : timeAgo(lastUpdated ? new Date(lastUpdated).toISOString() : null, now).toLowerCase()}`}
          </p>
          <button type="button" onClick={() => void load()} disabled={refreshing} className="link text-sm disabled:opacity-60">
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {snapshot?.alerts.length ? (
          <ul aria-label="Alerts for Fremont" className="mt-4 grid gap-2">
            {snapshot.alerts.map((alert) => (
              <li
                key={alert.id}
                className={`rounded-2xl border p-4 ${alert.severity === "Extreme" || alert.severity === "Severe" ? "border-signal bg-signal-wash text-signal" : "border-ochre bg-ochre-wash text-ochre"}`}
              >
                <p className="font-semibold">⚠️ {alert.event}</p>
                {alert.headline ? <p className="mt-1 text-sm">{alert.headline}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}

        <h2 id="news-heading" className="sr-only">
          News stories
        </h2>
        <div role="group" aria-label="Filter news by topic" className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          <CategoryChip active={category === "all"} onClick={() => setCategory("all")} icon="🗞️" label="All news" count={items.length} />
          {NEWS_CATEGORIES.map((c) => (
            <CategoryChip
              key={c.id}
              active={category === c.id}
              onClick={() => setCategory(c.id)}
              icon={c.icon}
              label={c.label}
              count={items.filter((i) => i.category === c.id).length}
            />
          ))}
        </div>

        {status === "loading" && !snapshot ? (
          <ul aria-hidden="true" className="mt-4 grid gap-3">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="h-28 animate-pulse rounded-2xl bg-white" />
            ))}
          </ul>
        ) : null}

        {preview ? (
          <p className="mt-4 rounded-2xl bg-white p-4 text-base text-ink-soft">
            News articles load on the full Docket site. This preview shows live incidents, alerts and city issues for {district}.
          </p>
        ) : null}

        {snapshot && !preview ? (
          <>
            <StoryList title={`In ${district}`} empty={`No ${category === "all" ? "" : `${newsCategoryInfo(category).label.toLowerCase()} `}stories naming ${district} right now.`} items={local} district={district} newIds={newIds} now={now} />
            <StoryList title="Around Fremont" empty="Nothing else from around Fremont for this topic right now." items={around} district={district} newIds={newIds} now={now} />
          </>
        ) : null}
      </section>

      <aside className="grid content-start gap-6">
        <SideCard title={`Happening now near ${district}`}>
          {snapshot?.incidents.length ? (
            <ul className="grid gap-3">
              {snapshot.incidents.slice(0, 12).map((incident) => {
                const info = liveKindInfo(incident.kind);
                return (
                  <li key={incident.id} className="flex gap-3">
                    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-sky-mist" style={{ boxShadow: `inset 0 0 0 2px ${info.color}` }}>
                      {info.icon}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold leading-snug text-ink">{incident.title}</p>
                      {incident.subtitle ? <p className="text-sm text-ink-soft">{incident.subtitle}</p> : null}
                      <p className="text-sm text-ink-muted">
                        {timeAgo(incident.startedAt, now)} · {incident.sourceUrl ? (
                          <a href={incident.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                            {incident.sourceName}
                          </a>
                        ) : (
                          incident.sourceName
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-base text-ink-soft">{snapshot ? "No incidents reported nearby right now." : "Checking live feeds…"}</p>
          )}
          <p className="mt-3 text-sm text-ink-muted">CHP incidents, road closures, outages, wildfires and earthquakes. Checked every minute.</p>
        </SideCard>

        <SideCard title="On the agenda">
          {snapshot?.issues.length ? (
            <ul className="grid gap-3">
              {snapshot.issues.map((issue) => {
                const state = issueStatus(issue, now);
                const votes = issue.votes;
                const share = votes && votes.support + votes.oppose ? Math.round((votes.support / (votes.support + votes.oppose)) * 100) : null;
                return (
                  <li key={issue.id}>
                    <Link href={`/g/${slug}?issue=${encodeURIComponent(issue.id)}`} className="block rounded-xl p-2 -m-2 hover:bg-sky-mist">
                      <span className="block font-semibold leading-snug text-ink">{issue.title}</span>
                      <span className="block text-sm" style={{ color: state.color }}>
                        {state.label}
                        {share !== null ? <span className="text-ink-soft"> · {share}% for</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-base text-ink-soft">{snapshot ? "No city issues for this neighborhood right now." : "Loading…"}</p>
          )}
        </SideCard>

        <SideCard title="Where this comes from">
          <p className="text-sm text-ink-soft">
            Google News, Tri-City Voice, Patch Fremont and r/Fremont posts that name {district}, plus CHP, Caltrans, CAL FIRE, USGS, the National
            Weather Service and California&apos;s outage map. Fremont Police and Fire don&apos;t publish live incident feeds; for police alerts follow{" "}
            <a href="https://local.nixle.com/fremont-police-department-ca/" target="_blank" rel="noopener noreferrer" className="underline">
              Fremont PD on Nixle
            </a>
            . Call 911 in an emergency.
          </p>
          {failing.length ? (
            <p className="mt-2 text-sm text-ochre">
              {failing.length === 1 ? `${failing[0].name} isn't responding` : `${failing.length} sources aren't responding`}; showing their latest copy.
            </p>
          ) : null}
        </SideCard>
      </aside>
    </div>
  );
}

function CategoryChip({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: string; label: string; count: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${
        active ? "border-ink bg-ink text-white" : "border-rule bg-white text-ink hover:border-ink/40"
      }`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
      <span className={`rounded-full px-1.5 font-mono text-xs ${active ? "bg-white/20" : "bg-sky-mist"}`}>{count}</span>
    </button>
  );
}

function StoryList({ title, empty, items, district, newIds, now }: { title: string; empty: string; items: NewsItem[]; district: string; newIds: Set<string>; now: number }) {
  const [shown, setShown] = useState(PAGE_SIZE);
  return (
    <section className="mt-6">
      <h3 className="text-xl font-semibold text-ink">
        {title} <span className="font-mono text-base font-normal text-ink-muted">{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="mt-3 rounded-2xl bg-white p-4 text-base text-ink-soft">{empty}</p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {items.slice(0, shown).map((item) => {
            const info = newsCategoryInfo(item.category);
            return (
              <li key={item.id}>
                <article className="rounded-2xl border border-rule bg-white p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: `${info.color}14`, color: info.color }}>
                      <span aria-hidden="true">{info.icon} </span>
                      {info.label}
                    </span>
                    {item.inNeighborhood ? <span className="rounded-full bg-park-wash px-2 py-0.5 text-xs font-semibold text-park">In {district}</span> : null}
                    {item.kind === "community" ? <span className="rounded-full bg-sky-mist px-2 py-0.5 text-xs font-semibold text-ink-soft">Community post</span> : null}
                    {newIds.has(item.id) ? <span className="rounded-full bg-[#b3261e] px-2 py-0.5 text-xs font-semibold text-white">New</span> : null}
                    <span className="text-ink-muted">
                      {item.source} · {item.publishedAt ? <time dateTime={item.publishedAt}>{timeAgo(item.publishedAt, now)}</time> : "Date unknown"}
                    </span>
                  </div>
                  <h4 className="mt-2 text-lg font-semibold leading-snug text-ink">
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline hover:underline-offset-4">
                      {item.title}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </h4>
                  {item.snippet ? <p className="mt-1 line-clamp-3 text-base text-ink-soft">{item.snippet}</p> : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > shown ? (
        <button type="button" onClick={() => setShown((n) => n + PAGE_SIZE)} className="btn btn-secondary mt-3 h-11 rounded-full px-5 text-sm">
          Show more ({items.length - shown})
        </button>
      ) : null}
    </section>
  );
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-rule bg-white p-5">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

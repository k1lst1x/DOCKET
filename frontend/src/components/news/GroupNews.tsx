"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { timeAgo } from "@/components/places/LivePanel";
import { aboutNeighborhood, DEFAULT_NEWS_QUERY, filterNews, newsHrefFor } from "@/lib/news/filter";
import { alertToNewsItem } from "@/lib/news/incidents";
import { newsCategoryInfo, type NewsItem } from "@/lib/news/types";
import { NewsDialog } from "./NewsDialog";
import { useNewsCatalog } from "./useNewsCatalog";

// A group page's news: the latest stories tagged with or naming its neighborhood, and live incidents
// inside it plus Fremont's weather and disaster alerts, each opening in a popup with a link to its
// source. Refreshes every minute.

const SHOWN = 6;

export function GroupNews({ name }: { name: string }) {
  const { catalog, status, preview } = useNewsCatalog();
  const [now, setNow] = useState(() => Date.now());
  const [openItem, setOpenItem] = useState<NewsItem | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const local = useMemo(() => filterNews(catalog?.items ?? [], DEFAULT_NEWS_QUERY, now).filter((item) => aboutNeighborhood(item, name)), [catalog, name, now]);
  const stories = useMemo(() => local.filter((i) => i.kind !== "incident"), [local]);
  const incidents = useMemo(
    () => [...(catalog?.alerts ?? []).map(alertToNewsItem), ...local.filter((i) => i.kind === "incident" && i.neighborhoods.includes(name))],
    [catalog, local, name],
  );
  const pool = useMemo(() => [...stories, ...incidents], [stories, incidents]);
  const loading = status === "loading" && !catalog;

  return (
    <div className="mt-8">
      <p className="inline-flex items-center gap-2 text-sm text-ink-soft">
        <span aria-hidden="true" className="relative flex h-2.5 w-2.5">
          {status === "live" ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d93025] opacity-60" /> : null}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${status === "live" ? "bg-[#d93025]" : "bg-ink-muted"}`} />
        </span>
        {status === "error" ? "News is unavailable right now, retrying" : status === "loading" ? "Connecting" : "Live · checks for news every minute"}
      </p>

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <Column
          title={`Latest ${name} news`}
          items={stories}
          loading={loading}
          now={now}
          onOpen={setOpenItem}
          empty={preview ? "News articles load on the full Docket site." : `No recent stories name ${name}. Citywide stories are on the News page.`}
        />
        <Column title="Live incidents and alerts" items={incidents} loading={loading} now={now} onOpen={setOpenItem} empty={`No live incidents in ${name} right now.`} />
      </div>

      <Link href={newsHrefFor(name)} className="btn btn-secondary mt-5 h-11 rounded-full px-5">
        More {name} news
      </Link>

      <NewsDialog item={openItem} onClose={() => setOpenItem(null)} pool={pool} onOpenItem={setOpenItem} />
    </div>
  );
}

interface ColumnProps {
  title: string;
  items: NewsItem[];
  loading: boolean;
  now: number;
  empty: string;
  onOpen: (item: NewsItem) => void;
}

function Column({ title, items, loading, now, empty, onOpen }: ColumnProps) {
  return (
    <section className="rounded-2xl border border-rule bg-white p-2 sm:p-3">
      <h3 className="flex items-baseline justify-between gap-3 px-3 pb-1 pt-2 text-lg font-semibold text-ink">
        {title}
        {items.length ? <span className="font-mono text-sm font-normal text-ink-muted">{items.length}</span> : null}
      </h3>
      {loading ? (
        <ul aria-hidden="true" className="grid gap-2 p-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-14 animate-pulse rounded-xl bg-sky-mist" />
          ))}
        </ul>
      ) : items.length ? (
        <ul className="grid">
          {items.slice(0, SHOWN).map((item) => (
            <Row key={item.id} item={item} now={now} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <p className="px-3 pb-3 pt-1 text-base text-ink-soft">{empty}</p>
      )}
    </section>
  );
}

function Row({ item, now, onOpen }: { item: NewsItem; now: number; onOpen: (item: NewsItem) => void }) {
  const info = newsCategoryInfo(item.category);
  const kind = item.alert ? "Weather alert" : item.kind === "incident" ? "Live incident" : item.kind === "community" ? "Community post" : null;
  return (
    <li>
      <button type="button" aria-haspopup="dialog" onClick={() => onOpen(item)} className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-sky-mist">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-base" style={{ background: `${info.color}1f` }}>
          {item.alert ? "⚠️" : info.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-semibold leading-snug text-ink">{item.title}</span>
          <span className="mt-0.5 block text-sm text-ink-muted">{[kind, item.source, item.publishedAt ? timeAgo(item.publishedAt, now) : null].filter(Boolean).join(" · ")}</span>
        </span>
      </button>
    </li>
  );
}

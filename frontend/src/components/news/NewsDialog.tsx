"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BoundaryMap } from "@/components/BoundaryMap";
import { openChat, useChatContext } from "@/components/chat/chat-context-store";
import { SparkIcon } from "@/components/chat/ChatPanel";
import { clock, timeAgo, whereFromFremont } from "@/components/places/LivePanel";
import type { ChatContext } from "@/lib/chat-context";
import type { LiveKind } from "@/lib/live/types";
import { newsCategoryInfo, type NewsItem } from "@/lib/news/types";
import { readableAccent } from "@/lib/theme";

// A news story, community post, live incident or weather alert in its own popup: the summary, when
// and where, a map for incidents, the link to the original source, and the assistant with this item
// as context. Used on the news page, on group pages and on the Places map.

const ENDS_LABEL: Record<LiveKind, string> = {
  traffic: "Expected to clear",
  closure: "Scheduled to reopen",
  quake: "",
  fire: "",
  outage: "Estimated restoration",
  report: "",
};

const WEATHER_SOURCE = "National Weather Service";

const kindLabel = (item: NewsItem) =>
  item.alert
    ? item.source === WEATHER_SOURCE
      ? "Weather alert"
      : `${item.source} alert`
    : item.incident?.kind === "report"
      ? "Resident report"
      : item.kind === "incident"
        ? "Live incident"
        : item.kind === "community"
          ? "Community post"
          : "News article";

function sourceAction(item: NewsItem): string {
  if (item.alert) return item.source === WEATHER_SOURCE ? "Read the full alert from the National Weather Service" : `Read advisories on ${item.source}`;
  if (item.kind === "incident") return `View on ${item.source}`;
  if (item.kind === "community") return `Read the post on ${item.source}`;
  return `Read the full story on ${item.source}`;
}

function facts(item: NewsItem): { label: string; value: string }[] {
  const list: { label: string; value: string }[] = [];
  const incident = item.incident;
  if (incident) {
    if (item.publishedAt) list.push({ label: incident.kind === "report" ? "Reported" : "Started", value: clock(item.publishedAt) });
    if (incident.updatedAt) list.push({ label: "Last updated", value: clock(incident.updatedAt) });
    if (incident.endsAt && ENDS_LABEL[incident.kind]) list.push({ label: ENDS_LABEL[incident.kind], value: clock(incident.endsAt) });
    if (incident.magnitude !== null) {
      if (incident.kind === "quake") list.push({ label: "Magnitude", value: incident.magnitude.toFixed(1) });
      if (incident.kind === "fire") list.push({ label: "Size", value: `${Math.round(incident.magnitude).toLocaleString("en-US")} acres` });
      if (incident.kind === "outage") list.push({ label: "Customers affected", value: Math.round(incident.magnitude).toLocaleString("en-US") });
    }
  }
  const alert = item.alert;
  if (alert) {
    list.push({ label: "Severity", value: alert.severity });
    list.push({ label: "In effect until", value: alert.endsAt ? clock(alert.endsAt) : "Further notice" });
    if (item.publishedAt) list.push({ label: "Issued", value: clock(item.publishedAt) });
  }
  return list;
}

/** What the assistant is told about this item. */
export function newsChatContext(item: NewsItem): ChatContext {
  return {
    kind: item.alert ? "alert" : item.kind,
    label: kindLabel(item),
    title: item.title,
    details: [
      `Source: ${item.source}`,
      item.publishedAt ? `${item.incident?.kind === "report" ? "Reported" : item.kind === "incident" ? "Started" : "Published"}: ${clock(item.publishedAt)}` : "",
      item.neighborhoods.length ? `Fremont neighborhoods: ${item.neighborhoods.join(", ")}` : "Area: Fremont",
      `Topic: ${newsCategoryInfo(item.category).label}`,
      item.snippet ? `Summary: ${item.snippet}` : "",
      item.incident ? `Location: ${whereFromFremont(item.incident)}` : "",
      item.alert?.description ? `Alert text: ${item.alert.description}` : "",
      item.alert?.instruction ? `Instructions: ${item.alert.instruction}` : "",
    ].filter(Boolean),
    url: item.url,
  };
}

interface NewsDialogProps {
  item: NewsItem | null;
  onClose: () => void;
  /** Other items to suggest under the story. */
  pool?: NewsItem[];
  onOpenItem?: (item: NewsItem) => void;
  /** Filters the page to a neighborhood when its chip is picked. */
  onArea?: (name: string) => void;
}

export function NewsDialog({ item, onClose, pool, onOpenItem, onArea }: NewsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (item && !dialog.open) {
      dialog.showModal();
      document.documentElement.style.overflow = "hidden";
    } else if (!item && dialog.open) {
      dialog.close();
    }
  }, [item]);

  // Leaving the page while the popup is open unmounts it without a close event; undo the scroll lock.
  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open) document.documentElement.style.overflow = "";
    };
  }, []);

  const itemId = item?.id;
  useEffect(() => {
    if (!itemId) return;
    scrollRef.current?.scrollTo({ top: 0 });
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [itemId]);

  useChatContext(item ? newsChatContext(item) : null, 3);

  const point = useMemo(() => (item?.incident ? { lat: item.incident.lat, lng: item.incident.lng, label: item.title } : undefined), [item]);
  const related = useMemo(() => {
    if (!item || !pool || !onOpenItem) return [];
    const near = (other: NewsItem) =>
      item.neighborhoods.length ? other.neighborhoods.some((n) => item.neighborhoods.includes(n)) : other.category === item.category;
    return pool.filter((other) => other.id !== item.id && near(other)).slice(0, 3);
  }, [item, pool, onOpenItem]);

  const info = item ? newsCategoryInfo(item.category) : null;
  const list = item ? facts(item) : [];

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="news-dialog-title"
      onClose={() => {
        document.documentElement.style.overflow = "";
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      // overflow-clip: only the inner content scrolls, as in the issue dialog.
      className="m-0 h-[100svh] max-h-none w-full max-w-none overflow-clip bg-transparent p-0 backdrop:bg-[rgba(24,33,43,0.55)] backdrop:backdrop-blur-[2px] sm:m-auto sm:h-auto sm:max-h-[90svh] sm:w-[min(44rem,calc(100vw-3rem))] sm:rounded-2xl"
    >
      {item && info ? (
        <div className="flex h-[100svh] w-full flex-col overflow-hidden bg-white sm:h-auto sm:max-h-[90svh] sm:rounded-2xl">
          <header className="flex items-center gap-2 border-b border-rule px-4 py-2.5 sm:px-6">
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: `${info.color}14`, color: readableAccent(info.color) }}>
              <span aria-hidden="true">{info.icon} </span>
              {info.label}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${item.kind === "incident" ? "bg-signal-wash text-signal" : "bg-sky-mist text-ink-soft"}`}>
              {kindLabel(item)}
              {item.severity === "severe" ? " · serious" : ""}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              autoFocus
              onClick={() => dialogRef.current?.close()}
              aria-label="Close"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink hover:bg-ink/5"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-5 sm:px-6 sm:pb-6">
            <h2 id="news-dialog-title" className="display text-[1.625rem] leading-tight sm:text-[2rem]">
              {item.title}
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              {item.source}
              {item.publishedAt ? (
                <>
                  {" · "}
                  <time dateTime={item.publishedAt}>{clock(item.publishedAt)}</time>
                  {/ago|now/i.test(timeAgo(item.publishedAt, now)) ? ` (${timeAgo(item.publishedAt, now).toLowerCase()})` : ""}
                </>
              ) : null}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.neighborhoods.length ? (
                item.neighborhoods.map((name) =>
                  onArea ? (
                    <button key={name} type="button" onClick={() => onArea(name)} className="rounded-full bg-park-wash px-2.5 py-1 text-sm font-semibold text-park hover:underline">
                      {name} news
                    </button>
                  ) : (
                    <span key={name} className="rounded-full bg-park-wash px-2.5 py-1 text-sm font-semibold text-park">
                      {name}
                    </span>
                  ),
                )
              ) : item.incident ? null : (
                // Incidents outside every neighborhood aren't citywide; the map caption says where they are.
                <span className="rounded-full bg-sky-mist px-2.5 py-1 text-sm font-semibold text-ink-soft">{item.alert ? "Fremont area" : "Citywide"}</span>
              )}
            </div>

            {item.incident && point ? (
              <figure className="mt-4 overflow-hidden rounded-2xl border border-rule">
                <BoundaryMap label={`Map of where “${item.title}” is`} point={point} className="h-56 sm:h-64" />
                <figcaption className="px-4 py-2 text-sm text-ink-soft">{whereFromFremont(item.incident)}</figcaption>
              </figure>
            ) : null}

            {item.snippet ? <p className="reading mt-4 text-lg leading-relaxed text-ink">{item.snippet}</p> : null}
            {!item.snippet && item.kind === "article" ? (
              <p className="mt-4 text-base text-ink-soft">{item.source} shares only the headline in its feed. Open the full story below to read it.</p>
            ) : null}
            {item.alert?.description ? <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-ink">{item.alert.description}</p> : null}
            {item.alert?.instruction ? <p className="mt-3 whitespace-pre-line rounded-2xl bg-ochre-wash p-4 text-base font-semibold text-ochre">{item.alert.instruction}</p> : null}

            {list.length ? (
              <dl className="mt-4 grid gap-x-6 gap-y-3 rounded-2xl bg-sky-mist p-4 sm:grid-cols-2">
                {list.map((fact) => (
                  <div key={fact.label}>
                    <dt className="text-sm text-ink-muted">{fact.label}</dt>
                    <dd className="font-semibold text-ink">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2">
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  // Publisher names can be long ("California Department of Transportation | Caltrans"), so the label wraps.
                  className="btn btn-primary h-auto min-h-11 max-w-full whitespace-normal rounded-full px-5 py-2.5 text-left leading-snug"
                >
                  {sourceAction(item)}
                  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
                    <path d="M6 3h7v7M13 3L5.5 10.5M11 9.5V13H3V5h3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <p className="self-center text-sm text-ink-soft">Source: {item.source}</p>
              )}
              <button type="button" onClick={openChat} className="btn btn-secondary h-11 rounded-full px-5">
                <SparkIcon className="h-4 w-4" />
                Ask Docket about this
              </button>
            </div>
            {item.kind === "incident" ? <p className="mt-3 text-sm text-ink-muted">Live details come from {item.source}. Call 911 in an emergency.</p> : null}

            {related.length ? (
              <section aria-labelledby="news-dialog-related" className="mt-6 border-t border-rule pt-4">
                <h3 id="news-dialog-related" className="text-sm font-semibold text-ink">
                  {item.neighborhoods.length ? `More from ${item.neighborhoods.join(" and ")}` : `More ${info.label.toLowerCase()}`}
                </h3>
                <ul className="mt-2 grid gap-1">
                  {related.map((other) => (
                    <li key={other.id}>
                      <button type="button" onClick={() => onOpenItem?.(other)} className="w-full rounded-xl px-3 py-2 text-left hover:bg-sky-mist">
                        <span className="block font-semibold leading-snug text-ink">{other.title}</span>
                        <span className="block text-sm text-ink-muted">
                          {kindLabel(other)} · {other.source}
                          {other.publishedAt ? ` · ${timeAgo(other.publishedAt, now)}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

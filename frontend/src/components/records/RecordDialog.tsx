"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { BoundaryMap } from "@/components/BoundaryMap";
import { BarList } from "@/components/charts/BarList";
import { openChat, useChatContext } from "@/components/chat/chat-context-store";
import { SparkIcon } from "@/components/chat/ChatPanel";
import type { ChatContext } from "@/lib/chat-context";
import { formatDate, formatDateTime } from "@/lib/format";
import { moderateText } from "@/lib/moderation";
import type { CountBar, MonthCount, RecordDetail } from "@/lib/record-detail";
import type { RecordReviews } from "@/lib/record-reviews";

// A neighborhood record in its own popup: a resident's Fremont App request, a city project, a development
// site or a police or city alert. It shows the full record, a map, charts that put it in context (how often
// this problem comes up here and how the city closed them, how a site compares with others nearby, how often
// an agency posts), related records, and neighbors' reviews. There's no voting on records.

const REVIEW_MIN = 10;
const REVIEW_MAX = 2000;

type Load =
  | { status: "loading" }
  | { status: "ready"; detail: RecordDetail; reviews: RecordReviews; signedIn: boolean }
  | { status: "missing" }
  | { status: "error" };

const PROJECT_LABEL = { capital: "Capital project", street: "Street maintenance", transportation: "Transportation project", development: "Development site" } as const;

export function recordKindLabel(detail: Pick<RecordDetail, "kind" | "projectKind">): string {
  if (detail.kind === "report") return "Resident report";
  if (detail.kind === "alert") return "Police or city alert";
  return PROJECT_LABEL[detail.projectKind ?? "capital"];
}

/** What the assistant is told about the open record. */
export function recordChatContext(detail: RecordDetail): ChatContext {
  return {
    kind: detail.kind === "alert" ? "alert" : detail.kind === "report" ? "incident" : "place",
    label: recordKindLabel(detail),
    title: detail.title,
    details: [
      detail.neighborhood ? `Fremont neighborhood: ${detail.neighborhood}` : "Area: all of Fremont",
      detail.status ? `Status: ${detail.status}` : "",
      detail.publishedAt ? `Date: ${formatDateTime(detail.publishedAt)}` : "",
      detail.body ? `Text: ${detail.body.slice(0, 350)}` : "",
      ...detail.facts.slice(0, 6).map((f) => `${f.label}: ${f.value}`),
    ]
      .filter(Boolean)
      .slice(0, 10),
    url: detail.links[0]?.url ?? detail.url,
  };
}

interface RecordDialogProps {
  recordId: string | null;
  onClose: () => void;
  /** Opens another record in the same popup (related records). */
  onOpen: (id: string) => void;
  /** Shown while the record loads. */
  fallbackTitle?: string;
}

export function RecordDialog({ recordId, onClose, onOpen, fallbackTitle }: RecordDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (recordId && !dialog.open) {
      dialog.showModal();
      document.documentElement.style.overflow = "hidden";
    } else if (!recordId && dialog.open) {
      dialog.close();
    }
  }, [recordId]);

  // Leaving the page while the popup is open unmounts it without a close event; undo the scroll lock.
  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      if (dialog?.open) document.documentElement.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    if (!recordId) return;
    const controller = new AbortController();
    setLoad({ status: "loading" });
    scrollRef.current?.scrollTo({ top: 0 });
    fetch(`/api/records/${recordId}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (res.status === 404) return setLoad({ status: "missing" });
        if (!res.ok) return setLoad({ status: "error" });
        const data = (await res.json()) as { detail: RecordDetail; reviews: RecordReviews; viewer: { signedIn: boolean } };
        setLoad({ status: "ready", detail: data.detail, reviews: data.reviews, signedIn: data.viewer.signedIn });
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== "AbortError") setLoad({ status: "error" });
      });
    return () => controller.abort();
  }, [recordId, reloadKey]);

  const detail = load.status === "ready" ? load.detail : null;
  useChatContext(recordId && detail ? recordChatContext(detail) : null, 3);

  const first = detail?.points[0];
  const point = useMemo(() => (first ? { lat: first.lat, lng: first.lng, label: first.label } : undefined), [first?.lat, first?.lng, first?.label]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="record-dialog-title"
      onClose={() => {
        document.documentElement.style.overflow = "";
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      // overflow-clip: only the inner content scrolls, as in the issue and news popups.
      className="m-0 h-[100svh] max-h-none w-full max-w-none overflow-clip bg-transparent p-0 backdrop:bg-[rgba(24,33,43,0.55)] backdrop:backdrop-blur-[2px] sm:m-auto sm:h-auto sm:max-h-[92svh] sm:w-[min(52rem,calc(100vw-3rem))] sm:rounded-2xl"
    >
      {recordId ? (
        <div className="flex h-[100svh] w-full flex-col overflow-hidden bg-white sm:h-auto sm:max-h-[92svh] sm:rounded-2xl">
          <header className="flex items-center gap-2 border-b border-rule px-4 py-2.5 sm:px-6">
            {/* Chips keep their words on one line and wrap as whole chips on narrow screens. */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {detail ? (
                <>
                  <span className="whitespace-nowrap rounded-full bg-sky-mist px-2.5 py-0.5 text-sm font-semibold text-ink-soft">{recordKindLabel(detail)}</span>
                  {detail.neighborhood ? (
                    <span className="whitespace-nowrap rounded-full bg-park-wash px-2.5 py-0.5 text-sm font-semibold text-park">{detail.neighborhood}</span>
                  ) : null}
                  {detail.open !== null ? (
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-semibold ${detail.open ? "bg-ochre-wash text-ochre" : "bg-park-wash text-park"}`}>
                      {detail.open ? "Open" : "Closed"}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-sm font-semibold text-ink-soft">Neighborhood record</span>
              )}
            </div>
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

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-5 sm:px-6 sm:pb-8">
            {load.status === "ready" ? (
              <RecordView
                detail={load.detail}
                point={point}
                reviews={load.reviews}
                signedIn={load.signedIn}
                onOpen={onOpen}
                onReviews={(reviews) => setLoad((current) => (current.status === "ready" ? { ...current, reviews } : current))}
              />
            ) : (
              <DialogStatus status={load.status} title={fallbackTitle} onRetry={() => setReloadKey((k) => k + 1)} />
            )}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

function DialogStatus({ status, title, onRetry }: { status: "loading" | "missing" | "error"; title?: string; onRetry: () => void }) {
  if (status === "loading") {
    return (
      <div role="status" aria-live="polite">
        <h2 id="record-dialog-title" className="display text-[1.625rem] leading-tight sm:text-[2rem]">
          {title ?? "Loading…"}
        </h2>
        <span className="sr-only">Loading the record</span>
        <div aria-hidden="true" className="mt-5 h-56 animate-pulse rounded-2xl bg-sky-mist" />
        <div aria-hidden="true" className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="h-40 animate-pulse rounded-2xl bg-sky-mist" />
          <div className="h-40 animate-pulse rounded-2xl bg-sky-mist" />
        </div>
      </div>
    );
  }
  return (
    <div>
      <h2 id="record-dialog-title" className="display text-[1.625rem] leading-tight sm:text-[2rem]">
        {status === "missing" ? "This record isn't available" : "Docket couldn't load this record"}
      </h2>
      <p className="mt-2 text-base text-ink-soft">
        {status === "missing" ? "It may have been removed from the city's records." : "Check your connection and try again."}
      </p>
      {status === "error" ? (
        <button type="button" onClick={onRetry} className="btn btn-secondary mt-4 h-11 rounded-full px-5">
          Try again
        </button>
      ) : null}
    </div>
  );
}

function RecordView({
  detail,
  point,
  reviews,
  signedIn,
  onOpen,
  onReviews,
}: {
  detail: RecordDetail;
  point: { lat: number; lng: number; label: string } | undefined;
  reviews: RecordReviews;
  signedIn: boolean;
  onOpen: (id: string) => void;
  onReviews: (reviews: RecordReviews) => void;
}) {
  const { charts } = detail;
  const address = detail.facts.find((f) => f.label === "Address")?.value;
  const agency = detail.facts.find((f) => f.label === "Agency")?.value;
  const hasMonthly = charts.monthly.some((m) => m.value > 0);

  return (
    <>
      <h2 id="record-dialog-title" className="display text-[1.625rem] leading-tight sm:text-[2rem]">
        {detail.title}
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        {[
          detail.publishedAt ? `${detail.kind === "report" ? "Filed" : "Posted"} ${formatDateTime(detail.publishedAt)}` : null,
          detail.kind === "report" ? "Fremont App" : detail.kind === "alert" ? agency : "City of Fremont GIS",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {point ? (
        <figure className="mt-4 overflow-hidden rounded-2xl border border-rule">
          <BoundaryMap label={`Map of ${detail.title}`} point={point} className="h-56 sm:h-64" />
          <figcaption className="px-4 py-2 text-sm text-ink-soft">
            {detail.points.length > 1 ? `${detail.points.length} mapped locations; the first is pinned.` : (address ?? "Approximate location from city records.")}
          </figcaption>
        </figure>
      ) : null}

      {detail.body ? (
        detail.kind === "report" ? (
          <blockquote className="reading mt-4 border-l-4 border-park pl-4 text-lg leading-relaxed text-ink">“{detail.body}”</blockquote>
        ) : (
          <p className={`mt-4 text-lg leading-relaxed text-ink ${detail.kind === "alert" ? "whitespace-pre-line" : ""}`}>{detail.body}</p>
        )
      ) : null}

      {detail.facts.length ? (
        <dl className="mt-4 grid gap-x-6 gap-y-3 rounded-2xl bg-sky-mist p-4 sm:grid-cols-2">
          {detail.facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-sm text-ink-muted">{fact.label === "Status" && detail.kind === "development" ? "City status code" : fact.label}</dt>
              <dd className="break-words font-semibold text-ink">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {detail.segments.length ? <Segments segments={detail.segments} /> : null}

      {hasMonthly || charts.outcome.length || charts.breakdown.length || charts.comparison.length ? (
        <section aria-labelledby="record-charts" className="mt-6">
          <h3 id="record-charts" className="text-lg font-semibold text-ink">
            In context
          </h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {hasMonthly && charts.monthlyLabel ? (
              <ChartCard className="md:col-span-2">
                <MonthBars data={charts.monthly} label={charts.monthlyLabel} highlightName={detail.kind === "report" ? detail.title : null} />
              </ChartCard>
            ) : null}
            {charts.outcome.length && charts.outcomeLabel ? (
              <ChartCard title={charts.outcomeLabel}>
                <Bars rows={charts.outcome} color="#2F6A31" />
              </ChartCard>
            ) : null}
            {charts.breakdown.length && charts.breakdownLabel ? (
              // Full width when it has no neighbor in its row, so the grid doesn't leave an empty half.
              <ChartCard title={charts.breakdownLabel} className={charts.outcome.length || charts.comparison.length ? "" : "md:col-span-2"}>
                <Bars rows={charts.breakdown} color="#3D7CC9" />
              </ChartCard>
            ) : null}
            {charts.comparison.length && charts.comparisonLabel ? (
              <ChartCard title={charts.comparisonLabel} className={charts.breakdown.length ? "" : "md:col-span-2"}>
                <Bars rows={charts.comparison} color="#9a6a1f" />
              </ChartCard>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {detail.links.map((link, i) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`btn h-auto min-h-11 max-w-full whitespace-normal rounded-full px-5 py-2.5 text-left leading-snug ${i === 0 ? "btn-primary" : "btn-secondary"}`}
          >
            {link.label}
            <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
              <path d="M6 3h7v7M13 3L5.5 10.5M11 9.5V13H3V5h3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ))}
        <button type="button" onClick={openChat} className="btn btn-secondary h-11 rounded-full px-5">
          <SparkIcon className="h-4 w-4" />
          Ask Docket about this
        </button>
      </div>

      {detail.related.length && detail.relatedLabel ? (
        <section aria-labelledby="record-related" className="mt-6 border-t border-rule pt-4">
          <h3 id="record-related" className="text-lg font-semibold text-ink">
            {detail.relatedLabel}
          </h3>
          <ul className="mt-2 grid gap-1">
            {detail.related.map((other) => (
              <li key={other.id}>
                <button type="button" onClick={() => onOpen(other.id)} className="w-full rounded-xl px-3 py-2 text-left hover:bg-sky-mist">
                  <span className="block font-semibold leading-snug text-ink">{other.title}</span>
                  <span className="block text-sm text-ink-muted">
                    {[other.subtitle, other.publishedAt ? formatDate(other.publishedAt) : null].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ReviewsCard recordId={detail.id} reviews={reviews} signedIn={signedIn} onReviews={onReviews} />
    </>
  );
}

function ChartCard({ title, className = "", children }: { title?: string; className?: string; children: React.ReactNode }) {
  return (
    <figure className={`min-w-0 rounded-2xl border border-rule p-4 ${className}`}>
      {title ? <figcaption className="text-sm font-semibold text-ink">{title}</figcaption> : null}
      <div className={title ? "mt-2" : ""}>{children}</div>
    </figure>
  );
}

const Bars = ({ rows, color }: { rows: CountBar[]; color: string }) => <BarList rows={rows.map((r) => ({ key: r.label, label: r.label, value: r.value }))} color={color} />;

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const monthDate = (month: string) => new Date(`${month}-01T00:00:00Z`);

/** Twelve monthly columns; for resident reports, this record's category is the darker part of each column. */
export function MonthBars({ data, label, highlightName }: { data: MonthCount[]; label: string; highlightName: string | null }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  const highlighted = data.reduce((s, d) => s + (d.highlight ?? 0), 0);
  const summary = data.map((d) => `${MONTH_YEAR.format(monthDate(d.month))}: ${d.value}${highlightName ? ` (${d.highlight ?? 0} ${highlightName})` : ""}`).join("; ");
  return (
    <>
      <figcaption className="text-sm font-semibold text-ink">{label}</figcaption>
      <p className="mt-1 text-sm text-ink-muted">
        {total} in the past 12 months{highlightName ? `, ${highlighted} of them “${highlightName}”` : ""}
      </p>
      <div role="img" aria-label={`${label}. ${summary}`} className="mt-3 flex h-36 items-end gap-1 border-b border-rule">
        {data.map((d) => (
          <div key={d.month} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${MONTH_YEAR.format(monthDate(d.month))}: ${d.value}`}>
            {d.value ? (
              <div className="relative w-full overflow-hidden rounded-t bg-sky" style={{ height: `${(d.value / max) * 100}%` }}>
                {d.highlight ? <div className="absolute inset-x-0 bottom-0 bg-park" style={{ height: `${(d.highlight / d.value) * 100}%` }} /> : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1 flex justify-between text-xs text-ink-muted">
        <span>{MONTH.format(monthDate(data[0].month))}</span>
        <span>{MONTH.format(monthDate(data[Math.floor(data.length / 2)].month))}</span>
        <span>{MONTH.format(monthDate(data[data.length - 1].month))}</span>
      </div>
      {highlightName ? (
        <p aria-hidden="true" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-park" /> {highlightName}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-sky" /> Other requests
          </span>
        </p>
      ) : null}
    </>
  );
}

function Segments({ segments }: { segments: RecordDetail["segments"] }) {
  const shown = segments.slice(0, 12);
  return (
    <section aria-labelledby="record-segments" className="mt-6">
      <h3 id="record-segments" className="text-lg font-semibold text-ink">
        Streets in this program
      </h3>
      <div className="mt-2 overflow-x-auto rounded-2xl border border-rule">
        <table className="w-full min-w-[28rem] text-left text-base">
          <thead className="bg-sky-mist text-sm text-ink-muted">
            <tr>
              <th className="px-4 py-2 font-semibold">Street</th>
              <th className="px-4 py-2 font-semibold">From</th>
              <th className="px-4 py-2 font-semibold">To</th>
              <th className="px-4 py-2 font-semibold">Work</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {shown.map((s, i) => (
              <tr key={`${s.road}-${i}`}>
                <td className="px-4 py-2 font-semibold text-ink">{s.road}</td>
                <td className="px-4 py-2 text-ink-soft">{s.from ?? "—"}</td>
                <td className="px-4 py-2 text-ink-soft">{s.to ?? "—"}</td>
                <td className="px-4 py-2 text-ink-soft">{s.work ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {segments.length > shown.length ? <p className="mt-2 text-sm text-ink-muted">And {segments.length - shown.length} more street segments.</p> : null}
    </section>
  );
}

const REVIEW_ERRORS: Record<string, string> = {
  invalid_review: `Write between ${REVIEW_MIN} and ${REVIEW_MAX.toLocaleString("en-US")} characters.`,
  review_blocked: "That includes language Docket doesn't allow, such as swear words, slurs or threats. Please rephrase it.",
  not_signed_in: "Your sign-in has expired. Sign in again to post your review.",
  busy: "You're posting quickly. Wait a minute, then try again.",
  not_found: "This record isn't available anymore.",
  unavailable: "Docket couldn't save that right now. Try again in a moment.",
};

function ReviewsCard({ recordId, reviews, signedIn, onReviews }: { recordId: string; reviews: RecordReviews; signedIn: boolean; onReviews: (r: RecordReviews) => void }) {
  const pathname = usePathname();
  const [draft, setDraft] = useState(reviews.mine?.body ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(reviews.mine?.body ?? "");
    setEditing(false);
    setError(null);
  }, [recordId, reviews.mine?.body]);

  const trimmed = draft.trim();
  const blocked = trimmed.length > 0 && !moderateText(trimmed).ok;
  const valid = trimmed.length >= REVIEW_MIN && trimmed.length <= REVIEW_MAX && !blocked;
  const showForm = signedIn && (!reviews.mine || editing);

  async function send(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/records/${recordId}/reviews`, {
        method,
        headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
        body: method === "POST" ? JSON.stringify({ body: trimmed }) : undefined,
      });
      const data = (await res.json().catch(() => null)) as { reviews?: RecordReviews; error?: string } | null;
      if (res.ok && data?.reviews) {
        onReviews(data.reviews);
        setEditing(false);
        if (method === "DELETE") setDraft("");
      } else {
        setError(REVIEW_ERRORS[data?.error ?? "unavailable"] ?? REVIEW_ERRORS.unavailable);
      }
    } catch {
      setError(REVIEW_ERRORS.unavailable);
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid && !busy) void send("POST");
  };

  return (
    <section aria-labelledby="record-reviews" className="mt-6 border-t border-rule pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="record-reviews" className="text-lg font-semibold text-ink">
          Neighbor reviews
        </h3>
        <span className="text-sm text-ink-muted">{reviews.items.length === 1 ? "1 review" : `${reviews.items.length} reviews`}</span>
      </div>
      <p className="mt-1 text-base text-ink-soft">What neighbors know about this. No voting here, just what you&apos;ve seen.</p>

      {showForm ? (
        <form onSubmit={submit} className="mt-3">
          <label htmlFor={`review-${recordId}`} className="sr-only">
            Your review
          </label>
          <textarea
            id={`review-${recordId}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={REVIEW_MAX}
            rows={3}
            placeholder="Is it fixed? Still a problem? What should neighbors know?"
            aria-describedby={`review-${recordId}-hint`}
            className="field h-auto min-h-24 py-3"
          />
          <p id={`review-${recordId}-hint`} className={`mt-1 text-sm ${blocked ? "text-signal" : "text-ink-muted"}`}>
            {blocked
              ? REVIEW_ERRORS.review_blocked
              : trimmed.length < REVIEW_MIN
                ? `At least ${REVIEW_MIN} characters.`
                : `${trimmed.length.toLocaleString("en-US")} of ${REVIEW_MAX.toLocaleString("en-US")} characters.`}
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-sm font-semibold text-signal">
              {error}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="submit" disabled={!valid || busy} className="btn btn-primary h-11 rounded-full px-5">
              {busy ? "Saving…" : reviews.mine ? "Save changes" : "Post review"}
            </button>
            {reviews.mine ? (
              <button type="button" onClick={() => setEditing(false)} className="btn btn-secondary h-11 rounded-full px-5">
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      ) : !signedIn ? (
        <p className="mt-3 rounded-2xl bg-sky-mist p-4 text-base text-ink-soft">
          <a href={`/signin?next=${encodeURIComponent(`${pathname}?record=${recordId}`)}`} className="link">
            Log in or register
          </a>{" "}
          to write a review.
        </p>
      ) : null}
      {!showForm && error ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-signal">
          {error}
        </p>
      ) : null}

      {reviews.items.length ? (
        <ul className="mt-4 grid gap-3">
          {reviews.items.map((review) => (
            <li key={review.id} className="rounded-2xl border border-rule p-4">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
                <span className="font-semibold text-ink">{review.mine ? "You" : review.author}</span>
                <time dateTime={review.createdAt}>{formatDate(review.createdAt)}</time>
                {review.edited ? <span>(edited)</span> : null}
                {review.sample ? <span className="rounded-full bg-ochre-wash px-2 py-0.5 font-semibold text-ochre">Sample</span> : null}
              </p>
              <p className="mt-1 whitespace-pre-line text-base leading-relaxed text-ink">{review.body}</p>
              {review.mine && !editing ? (
                <div className="mt-2 flex gap-3 text-sm">
                  <button type="button" onClick={() => setEditing(true)} className="link">
                    Edit
                  </button>
                  <button type="button" disabled={busy} onClick={() => void send("DELETE")} className="link text-signal">
                    Delete
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-base text-ink-muted">No reviews yet. {signedIn ? "Be the first." : ""}</p>
      )}
    </section>
  );
}

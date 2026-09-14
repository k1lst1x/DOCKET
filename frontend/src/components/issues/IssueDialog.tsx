"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { BoundaryMap } from "@/components/BoundaryMap";
import { useChatContext } from "@/components/chat/chat-context-store";
import { SparkIcon } from "@/components/chat/ChatPanel";
import { BarList } from "@/components/charts/BarList";
import { DeadlineMeter } from "@/components/charts/DeadlineMeter";
import { Donut } from "@/components/charts/Donut";
import { RATING_RAMP, VOTE_COLORS } from "@/components/charts/palette";
import { RATING_LABELS, RatingBars } from "@/components/charts/RatingBars";
import { ShareBars } from "@/components/charts/ShareBars";
import { TrendLine } from "@/components/charts/TrendLine";
import { ItemRef } from "@/components/ItemRef";
import { StatusPill } from "@/components/StatusPill";
import { formatDate, formatDateTime } from "@/lib/format";
import type { ChatContext } from "@/lib/chat-context";
import type { ClaimView, IssueActionErrorCode, IssueDetail, PollView } from "@/lib/issue-types";
import { moderateText } from "@/lib/moderation";

type ActionError = { path: "votes" | "reviews"; message: string };

const ACTION_ERRORS: Record<IssueActionErrorCode, string> = {
  not_signed_in: "Your sign-in has expired. Sign in again to vote.",
  not_found: "This item isn't open for discussion anymore.",
  not_member: "Voting is open to members of this group and of the neighborhoods it affects.",
  invalid_choice: "That option isn't on this poll.",
  closed: "Voting on this item has closed.",
  vote_first: "Vote or pass first, then you can write a review.",
  invalid_review: "Pick a rating and write at least 10 characters.",
  review_blocked: "Your review includes language Docket doesn't allow, such as swear words, slurs or threats. Please rephrase it.",
  busy: "Too many actions just now. Wait a minute, then try again.",
  unavailable: "Voting is unavailable right now. Try again shortly.",
};

const STANCE_CHOICES = [
  { id: "support", label: "Support", hint: "I'm for it", color: VOTE_COLORS.support },
  { id: "oppose", label: "Oppose", hint: "I'm against it", color: VOTE_COLORS.oppose },
  { id: "pass", label: "Pass", hint: "Give up my vote", color: VOTE_COLORS.pass },
] as const;

type LoadState = "loading" | "ready" | "missing" | "error";

interface IssueDialogProps {
  issueId: string | null;
  onClose: () => void;
  fallbackTitle?: string;
}

export function IssueDialog({ issueId, onClose, fallbackTitle }: IssueDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const busyRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (issueId && !dialog.open) {
      dialog.showModal();
      document.documentElement.style.overflow = "hidden";
    } else if (!issueId && dialog.open) {
      dialog.close();
    }
  }, [issueId]);

  useEffect(() => {
    if (!issueId) return;
    let alive = true;
    setState("loading");
    setActionError(null);
    fetch(`/api/issues/${encodeURIComponent(issueId)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!alive) return;
        if (res.status === 404) return setState("missing");
        if (!res.ok) return setState("error");
        const data = (await res.json()) as IssueDetail;
        if (!alive) return;
        setDetail(data);
        setState("ready");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [issueId, reloadKey]);

  // Real-time: refresh votes, charts and reviews every 15 s while open (and on tab
  // focus). When the database is unreachable, keep retrying every 20 s so the
  // dialog switches back to live data on its own.
  useEffect(() => {
    if (!issueId || (state !== "ready" && state !== "error")) return;
    let active = true;
    const url = `/api/issues/${encodeURIComponent(issueId)}`;
    const refresh = async () => {
      if (document.hidden || busyRef.current) return;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as IssueDetail;
        if (active && !busyRef.current) {
          setDetail(data);
          setState("ready");
        }
      } catch {
        // Keep what's on screen; the next tick tries again.
      }
    };
    const every = state === "error" || detail?.live === false ? 20_000 : 15_000;
    const timer = window.setInterval(() => void refresh(), every);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [issueId, state, detail?.live]);

  async function post(path: "votes" | "reviews", payload: object): Promise<boolean> {
    if (!issueId) return false;
    setBusy(true);
    busyRef.current = true;
    setActionError(null);
    try {
      const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        setDetail(data as IssueDetail);
        return true;
      }
      const code = (data?.error ?? "unavailable") as IssueActionErrorCode;
      setActionError({ path, message: ACTION_ERRORS[code] ?? ACTION_ERRORS.unavailable });
      return false;
    } catch {
      setActionError({ path, message: "We couldn't reach Docket. Check your connection and try again." });
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const ready = state === "ready" && detail !== null && detail.id === issueId;
  useChatContext(ready ? issueChatContext(detail) : issueId && fallbackTitle ? { kind: "issue", label: "City issue", title: fallbackTitle, details: [] } : null, 3);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="issue-dialog-title"
      onClose={() => {
        document.documentElement.style.overflow = "";
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      // overflow-clip: browsers give modal dialogs overflow:auto, so posting a vote or review (focus moves,
      // forms remount) could scroll the transparent dialog itself and push the white panel out of view,
      // leaving only a thin scrollbar strip. Only the inner content area scrolls now.
      className="m-0 h-[100svh] max-h-none w-full max-w-none overflow-clip bg-transparent p-0 backdrop:bg-[rgba(24,33,43,0.55)] backdrop:backdrop-blur-[2px] sm:m-auto sm:h-auto sm:max-h-[92svh] sm:w-[min(66rem,calc(100vw-3rem))] sm:rounded-2xl"
    >
      <div className="flex h-[100svh] w-full flex-col overflow-hidden bg-canvas sm:h-auto sm:max-h-[92svh] sm:rounded-2xl">
        <header className="flex items-center gap-3 border-b border-rule px-4 py-2.5 sm:px-6">
          <p className="min-w-0 flex-1 truncate text-sm text-ink-muted">
            {ready ? (detail.group ? detail.group.name : "Citywide") : "Neighborhood item"}
          </p>
          {ready ? <LiveBadge live={detail.live} /> : null}
          <button
            type="button"
            autoFocus
            onClick={() => dialogRef.current?.close()}
            aria-label="Close"
            className="grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-ink/5"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {ready ? (
            <IssueView
              detail={detail}
              busy={busy}
              actionError={actionError}
              onVote={(pollId, choice) => post("votes", { pollId, choice })}
              onReview={(rating, body) => post("reviews", { rating, body })}
            />
          ) : (
            <DialogStatus state={state} title={fallbackTitle} onRetry={() => setReloadKey((k) => k + 1)} />
          )}
        </div>
      </div>
    </dialog>
  );
}

/** What the assistant is told about the open issue. */
function issueChatContext(detail: IssueDetail): ChatContext {
  return {
    kind: "issue",
    label: "City issue",
    title: `${detail.title} (${detail.ref})`,
    details: [
      detail.analysis?.summary ? `Summary: ${detail.analysis.summary}` : `Description: ${detail.body}`,
      `Status: ${detail.status}`,
      detail.group ? `Neighborhood group: ${detail.group.name}` : "Citywide item",
      detail.neighborhoods.length ? `Affects: ${detail.neighborhoods.map((n) => n.name).join(", ")}` : "",
      detail.location?.label ? `Location: ${detail.location.label}` : "",
      detail.meetingAt ? `Meeting: ${formatDateTime(detail.meetingAt)}` : "",
      detail.deadline ? `${detail.deadlineKind ?? "Deadline"}: ${formatDateTime(detail.deadline)}` : "",
      detail.citation ? `Source document: ${detail.citation}` : "",
    ].filter(Boolean),
    url: detail.sourceUrl,
  };
}

function DialogStatus({ state, title, onRetry }: { state: LoadState; title?: string; onRetry: () => void }) {
  if (state === "missing" || state === "error") {
    return (
      <div className="px-6 py-16 text-center">
        <h2 id="issue-dialog-title" className="display text-[1.75rem] leading-tight">
          {state === "missing" ? "This item isn't open for discussion." : "We couldn't load this item."}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-base text-ink-soft">
          {state === "missing" ? "It may have been decided or removed." : "Docket keeps retrying on its own every 20 seconds, or you can try again now."}
        </p>
        {state === "error" ? (
          <button type="button" onClick={onRetry} className="btn btn-primary mt-6 rounded-full">
            Try again
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="px-4 py-8 sm:px-8">
      <h2 id="issue-dialog-title" className="display text-[1.875rem] leading-tight sm:text-[2.5rem]">
        {title ?? "Loading…"}
      </h2>
      <p role="status" className="sr-only">
        Loading details
      </p>
      <div aria-hidden="true" className="mt-6 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-sky-mist" />
        ))}
      </div>
      <div aria-hidden="true" className="mt-6 h-48 animate-pulse rounded-2xl bg-sky-mist" />
    </div>
  );
}

interface IssueViewProps {
  detail: IssueDetail;
  busy: boolean;
  actionError: ActionError | null;
  onVote: (pollId: string, choice: string) => Promise<boolean>;
  onReview: (rating: number, body: string) => Promise<boolean>;
}

function IssueView({ detail, busy, actionError, onVote, onReview }: IssueViewProps) {
  const stance = detail.polls.find((p) => p.kind === "stance") ?? null;
  const choicePolls = detail.polls.filter((p) => p.kind === "choice");
  const votesFor = (id: string) => stance?.options.find((o) => o.id === id)?.votes ?? 0;
  const decided = votesFor("support") + votesFor("oppose");
  const supportShare = decided ? Math.round((votesFor("support") / decided) * 100) : null;
  const live = detail.live;

  return (
    <article className="px-4 pb-12 pt-6 sm:px-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {detail.topic ? <span className="rounded-full bg-park-wash px-3 py-1 text-sm font-semibold text-park">{detail.topic}</span> : null}
        <StatusPill status={detail.status} />
        <ItemRef value={detail.ref} />
        {detail.sample.issue ? <SampleBadge>Sample item</SampleBadge> : null}
      </div>
      <h2 id="issue-dialog-title" className="display mt-3 text-[1.875rem] leading-tight sm:text-[2.5rem]">
        {detail.title}
      </h2>
      <p className="mt-2 text-base text-ink-soft">
        {detail.body}
        {detail.meetingAt ? (
          <>
            {" · "}
            <time dateTime={detail.meetingAt} className="font-mono text-sm">
              {formatDateTime(detail.meetingAt)}
            </time>
          </>
        ) : null}
      </p>

      {live ? null : <OfflineBanner />}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Tile>
          {detail.deadline ? (
            <DeadlineMeter start={detail.surfacedAt} deadline={detail.deadline} label={detail.deadlineKind ?? "Deadline"} />
          ) : (
            <TileStat label="Deadline" value="None set" />
          )}
        </Tile>
        <Tile>
          <TileStat
            label="Neighbors weighed in"
            value={live ? String(stance?.total ?? 0) : "–"}
            note={!live ? "Reconnecting…" : stance ? `${stance.passes} passed · ${detail.reviewCount} reviews` : undefined}
          />
        </Tile>
        <Tile>
          <TileStat
            label="Support among voters"
            value={supportShare === null ? "–" : `${supportShare}%`}
            note={!live ? "Reconnecting…" : supportShare === null ? "No votes yet" : `${100 - supportShare}% oppose`}
          />
          {supportShare !== null ? (
            <div aria-hidden="true" className="mt-2 flex h-2 gap-[2px] overflow-hidden rounded-full">
              <span className="h-full rounded-l-full" style={{ width: `${supportShare}%`, background: VOTE_COLORS.support }} />
              <span className="h-full rounded-r-full" style={{ width: `${100 - supportShare}%`, background: VOTE_COLORS.oppose }} />
            </div>
          ) : null}
        </Tile>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-6">
          <SummaryCard detail={detail} />
          <div className="grid gap-4 sm:grid-cols-2">
            <ClaimList title="Pros" tone="pro" items={detail.analysis?.pros ?? []} />
            <ClaimList title="Cons" tone="con" items={detail.analysis?.cons ?? []} />
          </div>
          {stance && live ? <VoteCard detail={detail} stance={stance} busy={busy} actionError={actionError?.path === "votes" ? actionError.message : null} onVote={onVote} /> : null}
          {live ? null : <OfflineVoteCard question={stance?.question ?? null} />}
          {(live ? choicePolls : []).map((poll) => (
            <Card key={poll.id} title="Follow-up question">
              <p className="text-lg font-semibold leading-snug text-ink">{poll.question}</p>
              <div className="-mx-3 mt-3">
                <BarList
                  rows={poll.options.map((o) => ({ key: o.id, label: o.label, value: o.votes }))}
                  selectedKey={poll.myChoice}
                  onSelect={detail.viewer.canVote ? (key) => void onVote(poll.id, key) : undefined}
                  disabled={busy}
                />
              </div>
              <p className="mt-2 text-sm text-ink-muted">
                {poll.total} {poll.total === 1 ? "answer" : "answers"}
                {detail.viewer.canVote ? " · choose an option to answer or change it" : ""}
              </p>
            </Card>
          ))}
          {live ? (
            <ReviewsCard detail={detail} busy={busy} error={actionError?.path === "reviews" ? actionError.message : null} onReview={onReview} />
          ) : null}
        </div>

        <aside className="grid content-start gap-6">
          {detail.analysis?.facts.length ? (
            <Card title="Key facts">
              <dl className="grid grid-cols-2 gap-3">
                {detail.analysis.facts.map((fact) => (
                  <div key={fact.label} className="rounded-xl bg-sky-mist px-3 py-3">
                    <dt className="text-sm text-ink-soft">{fact.label}</dt>
                    <dd className="mt-0.5 text-lg font-semibold leading-snug text-ink">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : null}
          <MapCard detail={detail} />
          {live && stance && stance.total > 0 ? (
            <Card title="How the vote moved">
              <TrendLine points={detail.trend} />
            </Card>
          ) : null}
          {detail.byNeighborhood.length > 1 ? (
            <Card title="By neighborhood">
              <ShareBars rows={detail.byNeighborhood} />
            </Card>
          ) : null}
        </aside>
      </div>
    </article>
  );
}

function SummaryCard({ detail }: { detail: IssueDetail }) {
  const analysis = detail.analysis;
  return (
    <section className="rounded-2xl border border-rule bg-[linear-gradient(180deg,#F4F9FE_0%,#FFFFFF_60%)] p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-[linear-gradient(135deg,#8DC2F5,#6DB33F)] text-white">
          <SparkIcon className="h-4 w-4" />
        </span>
        <h3 className="text-lg font-semibold text-ink">AI summary</h3>
        {detail.sample.analysis ? <SampleBadge>Sample summary</SampleBadge> : null}
      </div>
      {analysis ? (
        <div className="reading mt-4 space-y-3">
          {analysis.summary.split(/\n\s*\n/).map((paragraph) => (
            <p key={paragraph.slice(0, 40)}>{paragraph}</p>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-base text-ink-soft">An AI summary appears here once Docket has read this item&apos;s documents.</p>
      )}
      <p className="mt-4 text-sm text-ink-muted">
        {detail.citation ? <>Source: {detail.citation}. </> : null}
        AI summaries can miss things, so check the source before you rely on them.
      </p>
    </section>
  );
}

function ClaimList({ title, tone, items }: { title: string; tone: "pro" | "con"; items: ClaimView[] }) {
  const pro = tone === "pro";
  return (
    <section className="rounded-2xl border border-rule bg-white p-5">
      <h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
        <span aria-hidden="true" className={`grid h-7 w-7 place-items-center rounded-full ${pro ? "bg-park-wash text-park" : "bg-signal-wash text-signal"}`}>
          <svg viewBox="0 0 16 16" className="h-4 w-4">
            <path d={pro ? "M8 3.5v9M3.5 8h9" : "M3.5 8h9"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        {title}
      </h3>
      {items.length ? (
        <ul className="mt-3 grid gap-3">
          {items.map((claim) => (
            <li key={claim.text} className="border-t border-rule pt-3 first:border-t-0 first:pt-0">
              <p className="text-base leading-relaxed text-ink">{claim.text}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                {claim.basis === "source" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-mist px-2 py-0.5 font-semibold text-ink-soft">
                    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
                      <path d="M4 2h5.5L12 4.5V14H4z M9 2v3h3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                    </svg>
                    From the documents
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ochre-wash px-2 py-0.5 font-semibold text-ochre">
                    <SparkIcon className="h-3.5 w-3.5" />
                    AI inference
                  </span>
                )}
                {claim.citation ? <span className="font-mono text-ink-muted">{claim.citation}</span> : null}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-base text-ink-muted">None identified yet.</p>
      )}
    </section>
  );
}

function VoteCard({
  detail,
  stance,
  busy,
  actionError,
  onVote,
}: {
  detail: IssueDetail;
  stance: PollView;
  busy: boolean;
  actionError: string | null;
  onVote: (pollId: string, choice: string) => Promise<boolean>;
}) {
  const { viewer } = detail;
  const votes = (id: string) => stance.options.find((o) => o.id === id)?.votes ?? 0;
  const chosen = STANCE_CHOICES.find((c) => c.id === stance.myChoice);

  return (
    <Card
      title="Neighborhood vote"
      badge={detail.sample.activity ? <SampleBadge>Includes sample votes</SampleBadge> : null}
    >
      <p className="text-lg font-semibold leading-snug text-ink">{stance.question}</p>
      {viewer.votingAs ? <p className="mt-1 text-sm text-ink-muted">Voting as a member of {viewer.votingAs}</p> : null}

      {viewer.canVote ? (
        <div role="group" aria-label="Your vote" className="mt-4 grid gap-2.5 sm:grid-cols-3">
          {STANCE_CHOICES.map((choice) => {
            const selected = stance.myChoice === choice.id;
            return (
              <button
                key={choice.id}
                type="button"
                aria-pressed={selected}
                disabled={busy}
                onClick={() => void onVote(stance.id, choice.id)}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors disabled:cursor-wait ${
                  selected ? "on-dark border-ink bg-ink text-white" : "border-rule bg-white text-ink hover:border-ink/40 hover:bg-sky-mist"
                }`}
              >
                <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-white" style={{ background: choice.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{choice.label}</span>
                  <span className={`block text-sm ${selected ? "text-white/80" : "text-ink-muted"}`}>{choice.hint}</span>
                </span>
                {selected ? (
                  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-5 w-5 shrink-0">
                    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <VoteGate detail={detail} />
      )}

      {actionError ? (
        <p role="alert" className="mt-3 rounded-xl bg-signal-wash px-4 py-2.5 text-sm font-semibold text-signal">
          {actionError}
        </p>
      ) : null}
      {chosen ? (
        <p role="status" className="mt-3 text-sm text-ink-soft">
          {chosen.id === "pass" ? "You passed on this vote." : `You voted ${chosen.label.toLowerCase()}.`} Reviews are unlocked
          {viewer.closed ? "." : ", and you can change your vote until the deadline."}
        </p>
      ) : null}

      <div className="mt-6 border-t border-rule pt-6">
        <Donut
          title="Neighborhood vote results"
          segments={[
            { key: "support", label: "Support", value: votes("support"), color: VOTE_COLORS.support },
            { key: "oppose", label: "Oppose", value: votes("oppose"), color: VOTE_COLORS.oppose },
            { key: "pass", label: "Passed", value: stance.passes, color: VOTE_COLORS.pass },
          ]}
        />
      </div>
    </Card>
  );
}

function VoteGate({ detail }: { detail: IssueDetail }) {
  const { viewer, group } = detail;
  const here = group ? `/g/${group.slug}?issue=${detail.id}` : "/groups";
  if (viewer.closed) {
    return (
      <p className="mt-4 rounded-2xl bg-sky-mist px-4 py-3 text-base text-ink-soft">
        Voting closed{detail.deadline ? ` on ${formatDate(detail.deadline)}` : ""}. The results below are final.
      </p>
    );
  }
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-sky-mist p-4 sm:flex-row sm:items-center">
      <p className="flex-1 text-base text-ink-soft">
        {viewer.signedIn
          ? `Voting is open to members of ${group?.name ?? "this group"} and of the neighborhoods this affects.`
          : `Join ${group?.name ?? "a group"} or sign in to vote. Joining takes one screen.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {group ? (
          <Link href={`/g/${group.slug}/join`} className="btn btn-primary h-11 rounded-full px-5">
            Join to vote
          </Link>
        ) : null}
        {!viewer.signedIn ? (
          <Link href={`/signin?next=${encodeURIComponent(here)}`} className="btn btn-secondary h-11 rounded-full px-5">
            Sign in
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function ReviewsCard({
  detail,
  busy,
  error,
  onReview,
}: {
  detail: IssueDetail;
  busy: boolean;
  error: string | null;
  onReview: IssueViewProps["onReview"];
}) {
  if (!detail.reviews) {
    return (
      <Card title="Reviews">
        <div className="flex items-start gap-4 rounded-2xl bg-sky-mist p-5">
          <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-ink">
            <svg viewBox="0 0 20 20" className="h-5 w-5">
              <rect x="4" y="9" width="12" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </span>
          <div>
            <p className="text-lg font-semibold text-ink">Vote or pass to unlock reviews</p>
            <p className="mt-1 text-base text-ink-soft">
              {detail.reviewCount
                ? `${detail.reviewCount} ${detail.reviewCount === 1 ? "neighbor has" : "neighbors have"} explained their vote. `
                : ""}
              Reviews open once you&apos;ve made your own call, so everyone decides for themselves first.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const { reviews } = detail;
  return (
    <Card title="Reviews" badge={reviews.items.some((r) => r.sample) ? <SampleBadge>Includes sample reviews</SampleBadge> : null}>
      <RatingBars distribution={reviews.distribution} average={reviews.average} />
      {detail.viewer.canVote ? <ReviewForm key={reviews.mine?.body ?? "new"} mine={reviews.mine} busy={busy} error={error} onReview={onReview} /> : null}
      {reviews.items.length ? (
        <ul className="mt-6 grid gap-3">
          {reviews.items.map((review) => (
            <li key={review.id} className={`rounded-2xl border p-4 ${review.mine ? "border-ink/30 bg-sky-mist/60" : "border-rule bg-white"}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full bg-park-wash text-sm font-semibold text-park">
                  {review.author.charAt(0)}
                </span>
                <span className="font-semibold text-ink">{review.mine ? "You" : review.author}</span>
                {review.neighborhood ? <span className="text-sm text-ink-muted">{review.neighborhood}</span> : null}
                <span
                  className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold"
                  style={{ background: "#EEF4FC", color: "#1c4f8f" }}
                >
                  <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: RATING_RAMP[review.rating - 1] }} />
                  {RATING_LABELS[review.rating - 1]}
                </span>
              </div>
              <p className="reading mt-2 text-ink">{review.body}</p>
              <p className="mt-2 text-sm text-ink-muted">
                <time dateTime={review.createdAt}>{formatDate(review.createdAt)}</time>
                {review.sample ? " · sample review" : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-base text-ink-muted">No reviews yet. Yours can be the first.</p>
      )}
    </Card>
  );
}

function ReviewForm({
  mine,
  busy,
  error,
  onReview,
}: {
  mine: { rating: number; body: string } | null;
  busy: boolean;
  error: string | null;
  onReview: IssueViewProps["onReview"];
}) {
  const id = useId();
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [body, setBody] = useState(mine?.body ?? "");
  const [saved, setSaved] = useState(false);
  const length = body.trim().length;
  // Same check the server runs, so people see what to change before they post.
  const language = useMemo(() => moderateText(body), [body]);
  const flagged = language.matches.map((m) => `“${m.length > 40 ? `${m.slice(0, 40)}…` : m}”`).join(", ");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!rating || length < 10 || !language.ok) return;
    setSaved(await onReview(rating, body));
  }

  return (
    <form onSubmit={submit} className="mt-6 rounded-2xl border border-rule bg-sky-mist/60 p-4 sm:p-5">
      <fieldset>
        <legend className="label">{mine ? "Update your review" : "Your review"}</legend>
        <div className="flex flex-wrap gap-2">
          {RATING_LABELS.map((label, i) => (
            <label key={label} className="cursor-pointer">
              <input
                type="radio"
                name={`${id}-rating`}
                value={i + 1}
                checked={rating === i + 1}
                onChange={() => {
                  setRating(i + 1);
                  setSaved(false);
                }}
                className="peer sr-only"
              />
              <span className="inline-flex h-10 items-center gap-2 rounded-full border border-field bg-white px-3.5 text-sm text-ink transition-colors peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink">
                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: RATING_RAMP[i] }} />
                {label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor={`${id}-body`} className="label mt-4">
        Why?
      </label>
      <textarea
        id={`${id}-body`}
        rows={4}
        maxLength={2000}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setSaved(false);
        }}
        placeholder="What should neighbors know before the deadline?"
        aria-invalid={!language.ok}
        aria-describedby={!language.ok ? `${id}-language` : undefined}
        className="field h-auto min-h-[7rem] rounded-xl py-3"
      />
      {!language.ok ? (
        <p id={`${id}-language`} role="alert" className="mt-3 rounded-xl bg-signal-wash px-4 py-2.5 text-sm text-signal">
          <span className="font-semibold">Please rephrase before posting.</span> Reviews can&apos;t include swear words, slurs or
          threats, even with letters swapped or hidden{flagged ? `: ${flagged}` : ""}.
        </p>
      ) : error ? (
        <p role="alert" className="mt-3 rounded-xl bg-signal-wash px-4 py-2.5 text-sm font-semibold text-signal">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-ink-muted">{length < 10 ? `${10 - length} more characters` : `${length} / 2000`}</span>
        <button type="submit" className="btn btn-primary rounded-full" disabled={busy || !rating || length < 10 || !language.ok}>
          {mine ? "Update review" : "Post review"}
        </button>
      </div>
      {saved ? (
        <p role="status" className="mt-2 text-sm font-semibold text-park">
          Saved. Thanks for explaining your vote.
        </p>
      ) : null}
    </form>
  );
}

function MapCard({ detail }: { detail: IssueDetail }) {
  const lat = detail.location?.lat;
  const lng = detail.location?.lng;
  const label = detail.location?.label ?? "";
  const point = useMemo(() => (lat !== undefined && lng !== undefined ? { lat, lng, label } : undefined), [lat, lng, label]);
  const citywide = detail.affectedRadiusM === null;

  return (
    <Card title="Where it applies">
      {point && !citywide ? (
        <div className="-mx-1 overflow-hidden rounded-xl border border-rule">
          <BoundaryMap label={`Map of ${label}`} point={point} radiusM={detail.affectedRadiusM} className="h-56" />
        </div>
      ) : null}
      <p className="mt-3 text-base text-ink">{citywide ? "Citywide" : label}</p>
      {detail.affectedRadiusM ? (
        <p className="text-sm text-ink-muted">Shaded circle: about {Math.round(detail.affectedRadiusM / 100) / 10} km around the site</p>
      ) : null}
      {detail.neighborhoods.length ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {detail.neighborhoods.map((n) => (
            <li key={n.slug} className="rounded-full border border-rule px-3 py-1 text-sm text-ink-soft">
              {n.name}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function Card({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-rule bg-white p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

function Tile({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-rule bg-white px-4 py-4">{children}</div>;
}

function TileStat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-ink-soft">{label}</p>
      <p className="mt-1 text-[1.75rem] font-semibold leading-tight text-ink">{value}</p>
      {note ? <p className="mt-0.5 text-sm text-ink-muted">{note}</p> : null}
    </div>
  );
}

function SampleBadge({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-ochre-wash px-2.5 py-0.5 text-sm font-semibold text-ochre">{children}</span>;
}

function LiveBadge({ live }: { live: boolean }) {
  if (live) {
    return (
      <span
        title="Votes, results and reviews refresh every 15 seconds"
        className="inline-flex items-center gap-1.5 rounded-full bg-park-wash px-2.5 py-0.5 text-sm font-semibold text-park"
      >
        <span aria-hidden="true" className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-park opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-park" />
        </span>
        Live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ochre-wash px-2.5 py-0.5 text-sm font-semibold text-ochre">
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-ochre" />
      Reconnecting
    </span>
  );
}

function OfflineBanner() {
  return (
    <p role="status" className="mt-5 rounded-2xl border border-ochre/30 bg-ochre-wash px-4 py-3 text-base text-ink">
      <span className="font-semibold">Live votes and reviews are reconnecting.</span> You&apos;re seeing the saved summary, pros and
      cons. This checks again every 20 seconds and updates on its own.
    </p>
  );
}

function OfflineVoteCard({ question }: { question: string | null }) {
  return (
    <Card title="Neighborhood vote">
      {question ? <p className="text-lg font-semibold leading-snug text-ink">{question}</p> : null}
      <p className="mt-3 rounded-2xl bg-sky-mist px-4 py-3 text-base text-ink-soft">
        Voting, results and reviews come back as soon as Docket reconnects to its database. Votes you&apos;ve already cast are saved.
      </p>
    </Card>
  );
}

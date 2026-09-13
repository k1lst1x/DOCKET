"use client";

import type { IssueMarker } from "@/lib/issue-types";
import { areaBySlug } from "@/lib/places";

// "Issues" tab on the Places page: city decisions, law and zoning changes, and how neighbors voted,
// each pinned where it applies.

export type IssueFilter = "open" | "decided" | "all";

const SUPPORT = "#2a78d6";
const OPPOSE = "#eb6834";
const PASS = "#b9b7ae";
const DAY_MS = 24 * 60 * 60 * 1000;

const isOpen = (issue: IssueMarker, now: number) => issue.status === "watching" && (!issue.deadline || Date.parse(issue.deadline) > now);

export function issueMatchesFilter(issue: IssueMarker, filter: IssueFilter, now: number): boolean {
  if (filter === "all") return true;
  return filter === "open" ? isOpen(issue, now) : !isOpen(issue, now);
}

export function issueStatus(issue: IssueMarker, now: number): { label: string; color: string } {
  if (issue.status === "approved") return { label: "Approved", color: "#2f6a31" };
  if (issue.status === "decided") return { label: "Decided", color: "#5f6368" };
  if (!issue.deadline) return { label: "Vote open", color: SUPPORT };
  const left = Date.parse(issue.deadline) - now;
  if (left <= 0) return { label: "Awaiting decision", color: "#865700" };
  const days = Math.floor(left / DAY_MS);
  const hours = Math.max(1, Math.round(left / 3_600_000));
  return { label: `Vote open · ${days >= 1 ? `${days} ${days === 1 ? "day" : "days"} left` : `${hours} hr left`}`, color: SUPPORT };
}

const supportShare = (issue: IssueMarker) => {
  const v = issue.votes;
  if (!v || v.support + v.oppose === 0) return null;
  return Math.round((v.support / (v.support + v.oppose)) * 100);
};

/** Map pin: a rounded ballot badge showing the share in support, bordered by status color. */
export function issuePin(issue: IssueMarker, selected: boolean, now: number): HTMLElement {
  const { color } = issueStatus(issue, now);
  const share = supportShare(issue);
  const pin = document.createElement("div");
  Object.assign(pin.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    height: selected ? "38px" : "32px",
    padding: selected ? "0 12px 0 8px" : "0 10px 0 6px",
    borderRadius: "9999px",
    background: selected ? "#262626" : "#ffffff",
    color: selected ? "#ffffff" : "#262626",
    border: `3px solid ${color}`,
    boxShadow: selected ? `0 0 0 3px ${color}, 0 6px 16px rgba(0,0,0,.35)` : "0 2px 8px rgba(0,0,0,.3)",
    font: "600 13px/1 system-ui, sans-serif",
    whiteSpace: "nowrap",
  });
  const icon = document.createElement("span");
  icon.textContent = "🗳️";
  icon.style.fontSize = selected ? "18px" : "15px";
  pin.append(icon);
  if (share !== null) {
    const label = document.createElement("span");
    label.textContent = `${share}% for`;
    pin.append(label);
  }
  return pin;
}

function VoteBar({ votes }: { votes: NonNullable<IssueMarker["votes"]> }) {
  const total = votes.support + votes.oppose + votes.pass;
  if (!total) return <p className="text-sm text-ink-muted">No votes yet.</p>;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-sky-mist" aria-hidden="true">
        <span style={{ width: pct(votes.support), background: SUPPORT }} />
        <span style={{ width: pct(votes.oppose), background: OPPOSE }} />
        <span style={{ width: pct(votes.pass), background: PASS }} />
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-ink-soft">
        <span>
          <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: SUPPORT }} />
          {votes.support} for
        </span>
        <span>
          <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: OPPOSE }} />
          {votes.oppose} against
        </span>
        <span>
          <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: PASS }} />
          {votes.pass} passed
        </span>
      </p>
    </div>
  );
}

interface IssuesPanelProps {
  issues: IssueMarker[];
  live: boolean;
  loaded: boolean;
  filter: IssueFilter;
  onFilter: (filter: IssueFilter) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
  now: number;
}

export function IssuesPanel({ issues, live, loaded, filter, onFilter, selectedId, onSelect, onOpen, now }: IssuesPanelProps) {
  const shown = issues.filter((i) => issueMatchesFilter(i, filter, now));
  const filters: [IssueFilter, string][] = [
    ["open", "Open for votes"],
    ["decided", "Decided"],
    ["all", "All issues"],
  ];

  return (
    <div>
      <p className="text-sm text-ink-soft">
        City decisions, zoning and law changes Docket is tracking, pinned where they apply, with how neighbors are voting.
      </p>
      <div role="group" aria-label="Filter issues" className="mt-3 flex flex-wrap gap-2">
        {filters.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => onFilter(id)}
            className={`inline-flex h-10 items-center rounded-full border px-3.5 text-sm font-medium transition-colors ${
              filter === id ? "border-ink bg-ink text-white" : "border-rule bg-white text-ink hover:border-ink/40"
            }`}
          >
            {label}
            <span className={`ml-1.5 rounded-full px-1.5 font-mono text-xs ${filter === id ? "bg-white/20" : "bg-sky-mist"}`}>
              {issues.filter((i) => issueMatchesFilter(i, id, now)).length}
            </span>
          </button>
        ))}
      </div>
      {loaded && !live ? (
        <p className="mt-2 text-sm text-ink-muted">Vote totals appear when Docket&apos;s database is reachable.</p>
      ) : null}

      {!loaded ? (
        <ul aria-hidden="true" className="mt-3 grid gap-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-20 animate-pulse rounded-2xl bg-white" />
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <p className="mt-3 rounded-2xl bg-white p-4 text-base text-ink-soft">No issues match this filter right now.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {shown.map((issue) => {
            const selected = issue.id === selectedId;
            const status = issueStatus(issue, now);
            const share = supportShare(issue);
            const hoods = issue.neighborhoods.map((slug) => areaBySlug(slug)?.name ?? slug).join(", ");
            return (
              <li key={issue.id} className="min-w-0">
                <button
                  id={`issue-${issue.id}`}
                  type="button"
                  aria-expanded={selected}
                  onClick={() => onSelect(selected ? null : issue.id)}
                  className={`flex w-full min-w-0 items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors ${
                    selected ? "border-ink bg-white shadow-sm" : "border-transparent bg-white hover:border-ink/25"
                  }`}
                >
                  <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-mist text-lg" style={{ boxShadow: `inset 0 0 0 2px ${status.color}` }}>
                    🗳️
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold leading-snug text-ink">{issue.title}</span>
                    <span className="mt-0.5 block text-sm font-semibold" style={{ color: status.color }}>
                      {status.label}
                      {share !== null ? <span className="font-normal text-ink-soft"> · {share}% for</span> : null}
                    </span>
                    <span className="block truncate text-sm text-ink-muted">{[issue.topic, issue.location.label].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
                {selected ? (
                  <div className="mx-1 -mt-2 grid gap-3 rounded-b-2xl border border-t-0 border-ink bg-white px-3.5 pb-4 pt-4 text-sm text-ink-soft">
                    {issue.votes ? <VoteBar votes={issue.votes} /> : null}
                    <p>
                      {hoods ? `Affects ${hoods}` : "Citywide"}
                      {issue.affectedRadiusM ? ` · about ${Math.round(issue.affectedRadiusM / 100) / 10} km around the site` : ""}
                      {issue.group ? ` · Watched by ${issue.group.name}` : ""}
                    </p>
                    <p className="font-mono text-xs text-ink-muted">
                      {issue.ref}
                      {issue.sample ? " · sample item" : ""}
                    </p>
                    <button type="button" onClick={() => onOpen(issue.id)} className="btn btn-primary h-10 justify-self-start rounded-full px-4 text-sm">
                      Open issue and vote
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

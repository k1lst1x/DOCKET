"use client";

import type { NeighborhoodShare } from "@/lib/issue-types";
import { CHART_INK, VOTE_COLORS } from "./palette";

const KEYS = ["support", "oppose", "pass"] as const;
const LABELS = { support: "Support", oppose: "Oppose", pass: "Pass" };

export function VoteLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
      {KEYS.map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: VOTE_COLORS[k] }} />
          {LABELS[k]}
        </li>
      ))}
    </ul>
  );
}

/** 100% stacked bar per neighborhood, with a 2px surface gap between segments. */
export function ShareBars({ rows }: { rows: NeighborhoodShare[] }) {
  return (
    <div>
      <VoteLegend />
      <ul className="mt-3 grid gap-3">
        {rows.map((row) => {
          const total = row.support + row.oppose + row.pass;
          return (
            <li key={row.slug}>
              <p className="flex items-baseline justify-between gap-3 text-base">
                <span className="text-ink">{row.name}</span>
                <span className="text-sm tabular-nums text-ink-muted">
                  {total} {total === 1 ? "voter" : "voters"}
                </span>
              </p>
              <div className="mt-1.5 flex h-3 w-full gap-[2px] overflow-hidden rounded-full" style={{ background: CHART_INK.track }}>
                {KEYS.map((k) =>
                  row[k] ? (
                    <span
                      key={k}
                      title={`${LABELS[k]}: ${row[k]} (${Math.round((row[k] / total) * 100)}%)`}
                      className="h-full first:rounded-l-full last:rounded-r-full"
                      style={{ width: `${(row[k] / total) * 100}%`, background: VOTE_COLORS[k] }}
                    />
                  ) : null,
                )}
              </div>
              <p className="sr-only">
                {LABELS.support} {row.support}, {LABELS.oppose} {row.oppose}, {LABELS.pass} {row.pass}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

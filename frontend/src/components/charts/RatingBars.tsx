"use client";

import { CHART_INK, RATING_RAMP } from "./palette";

export const RATING_LABELS = ["Strongly against", "Against", "Mixed", "For", "Strongly for"] as const;

/** Review sentiment: average as the headline number, then 5 → 1 bars on one blue ramp. */
export function RatingBars({ distribution, average }: { distribution: number[]; average: number | null }) {
  const total = distribution.reduce((s, n) => s + n, 0);
  const max = Math.max(1, ...distribution);

  return (
    <div className="grid gap-5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
      <div>
        <p className="text-[2.75rem] font-semibold leading-none text-ink">{average === null ? "–" : average.toFixed(1)}</p>
        <p className="mt-1 text-sm text-ink-muted">
          average of {total} {total === 1 ? "review" : "reviews"}
        </p>
        {average !== null ? (
          <p className="mt-1 text-sm font-semibold text-ink-soft">{RATING_LABELS[Math.min(4, Math.max(0, Math.round(average) - 1))]}</p>
        ) : null}
      </div>
      <ul className="grid gap-1.5">
        {[5, 4, 3, 2, 1].map((rating) => {
          const n = distribution[rating - 1] ?? 0;
          return (
            <li key={rating} className="grid grid-cols-[7.5rem_minmax(0,1fr)_2rem] items-center gap-3 text-sm">
              <span className="text-ink-soft">{RATING_LABELS[rating - 1]}</span>
              <span aria-hidden="true" className="block h-2.5 overflow-hidden rounded-full" style={{ background: CHART_INK.track }}>
                <span
                  className="block h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${n ? Math.max((n / max) * 100, 4) : 0}%`, background: RATING_RAMP[rating - 1] }}
                />
              </span>
              <span className="text-right font-semibold tabular-nums text-ink">{n}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

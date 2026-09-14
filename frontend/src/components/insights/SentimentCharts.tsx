import { CHART_INK, VOTE_COLORS } from "@/components/charts/palette";
import { formatMonthDay } from "@/lib/format";
import type { Stance } from "@/lib/sentiment";

// Small server-rendered charts for the public sentiment page: a stacked stance bar and weekly columns.
// Each has a text equivalent for screen readers.

export const STANCE_STYLE: Record<Stance, { label: string; color: string }> = {
  support: { label: "Support", color: VOTE_COLORS.support },
  oppose: { label: "Oppose", color: VOTE_COLORS.oppose },
  mixed: { label: "Mixed", color: "#8b6fd6" },
  neutral: { label: "Neutral", color: VOTE_COLORS.pass },
};

const ORDER: Stance[] = ["support", "oppose", "mixed", "neutral"];

export function StanceLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
      {ORDER.map((stance) => (
        <li key={stance} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: STANCE_STYLE[stance].color }} />
          {STANCE_STYLE[stance].label}
        </li>
      ))}
    </ul>
  );
}

/** One horizontal bar split by stance, with counts beneath. */
export function StanceBar({ counts, total, className = "" }: { counts: Record<Stance, number>; total: number; className?: string }) {
  const sum = ORDER.reduce((s, k) => s + counts[k], 0) || 1;
  const summary = ORDER.map((k) => `${counts[k]} ${STANCE_STYLE[k].label.toLowerCase()}`).join(", ");
  return (
    <div className={className}>
      <p className="sr-only">
        {total} filed {total === 1 ? "comment" : "comments"}: {summary}.
      </p>
      <div aria-hidden="true" className="flex h-3 w-full overflow-hidden rounded-full" style={{ background: CHART_INK.track }}>
        {ORDER.map((stance) =>
          counts[stance] ? <span key={stance} className="h-full" style={{ width: `${(counts[stance] / sum) * 100}%`, background: STANCE_STYLE[stance].color }} /> : null,
        )}
      </div>
      <p aria-hidden="true" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
        {ORDER.map((stance) => (
          <span key={stance} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: STANCE_STYLE[stance].color }} />
            <span className="font-semibold text-ink">{counts[stance]}</span> {STANCE_STYLE[stance].label.toLowerCase()}
          </span>
        ))}
      </p>
    </div>
  );
}

/** Filed comments per week as columns. */
export function WeekColumns({ weeks }: { weeks: { week: string; count: number }[] }) {
  if (!weeks.length) return <p className="text-base text-ink-soft">The filed letters don&apos;t carry dates yet.</p>;
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const label = (week: string) => formatMonthDay(`${week}T12:00:00-07:00`);
  return (
    <div>
      <ul className="sr-only">
        {weeks.map((w) => (
          <li key={w.week}>
            Week of {label(w.week)}: {w.count} {w.count === 1 ? "comment" : "comments"}
          </li>
        ))}
      </ul>
      <div aria-hidden="true" className="flex h-44 items-end gap-1.5 border-b pb-px" style={{ borderColor: CHART_INK.axis }}>
        {weeks.map((w) => (
          <div key={w.week} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="text-xs tabular-nums text-ink-soft">{w.count}</span>
            <span className="w-full max-w-10 rounded-t-md" style={{ height: `${Math.max((w.count / max) * 100, 4)}%`, background: VOTE_COLORS.support }} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1.5 flex gap-1.5">
        {weeks.map((w, i) => (
          <span key={w.week} className="min-w-0 flex-1 truncate text-center text-xs text-ink-muted">
            {i === 0 || i === weeks.length - 1 || weeks.length <= 6 ? label(w.week) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { formatDateTime, relativeUntil } from "@/lib/format";

const DAY_MS = 86_400_000;

/** Time used between when Docket surfaced the item and the deadline to act. */
export function DeadlineMeter({ start, deadline, label }: { start: string; deadline: string; label: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const begin = Date.parse(start);
  const end = Date.parse(deadline);
  const remaining = now === null ? null : end - now;
  const closed = remaining !== null && remaining <= 0;
  const urgent = remaining !== null && !closed && remaining < DAY_MS;
  const used = now === null ? 0 : Math.min(100, Math.max(0, ((now - begin) / Math.max(end - begin, 1)) * 100));
  const fill = urgent ? "rgb(var(--signal))" : closed ? "var(--chart-axis)" : "#2a78d6";
  // Tracks follow the theme (globals.css) so they don't glow on dark cards.
  const track = urgent ? "var(--meter-urgent-track)" : "var(--meter-track)";

  return (
    <div>
      <p className="text-sm font-semibold text-ink-soft">{label}</p>
      <p className={`mt-1 text-[1.5rem] font-semibold leading-tight ${urgent ? "text-signal" : "text-ink"}`} suppressHydrationWarning>
        {remaining === null ? "…" : closed ? "Closed" : relativeUntil(remaining).replace(/^in /, "")}
        {remaining !== null && !closed ? <span className="text-base font-normal text-ink-muted"> left</span> : null}
      </p>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(used)}
        aria-label="Share of the comment window already used"
        className="mt-2 h-2 w-full overflow-hidden rounded-full"
        style={{ background: track }}
      >
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${used}%`, background: fill }} />
      </div>
      <p className="mt-1.5 font-mono text-sm text-ink-muted" suppressHydrationWarning>
        {formatDateTime(deadline)}
      </p>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { formatDateTime, relativeUntil } from "@/lib/format";

const DAY_MS = 24 * 60 * 60 * 1000;

interface DeadlineProps {
  at: string;
  label?: string;
  /** Hide the label and absolute date; show only the countdown. */
  compact?: boolean;
}

/** Relative countdown that turns signal red inside 24 hours. */
export function Deadline({ at, label = "Deadline", compact = false }: DeadlineProps) {
  // The countdown renders after mount so server and client HTML match.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);

  const remaining = now === null ? null : Date.parse(at) - now;
  const closed = remaining !== null && remaining <= 0;
  const urgent = remaining !== null && !closed && remaining < DAY_MS;

  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-2 ${urgent ? "text-signal" : "text-ink-soft"}`}>
      {compact ? null : <span className="text-sm font-semibold">{label}</span>}
      {compact ? null : (
        <time dateTime={at} className="font-mono text-sm" suppressHydrationWarning>
          {formatDateTime(at)}
        </time>
      )}
      {remaining === null ? (
        compact ? (
          <time dateTime={at} className="font-mono text-sm" suppressHydrationWarning>
            {formatDateTime(at)}
          </time>
        ) : null
      ) : (
        <span className={`text-sm font-semibold ${urgent ? "text-signal" : closed ? "text-ink-muted" : "text-ink"}`}>
          {closed ? "Closed" : relativeUntil(remaining)}
          {urgent ? <span className="sr-only"> — less than a day left</span> : null}
        </span>
      )}
    </span>
  );
}

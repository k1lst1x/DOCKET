"use client";

import { useId, useState } from "react";

/** Relevance score; its reasoning appears on hover or keyboard focus. */
export function Score({ value, reason }: { value: number; reason: string }) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);

  return (
    <span className="group relative inline-flex" onMouseLeave={() => setDismissed(false)}>
      <button
        type="button"
        aria-describedby={id}
        onKeyDown={(e) => e.key === "Escape" && setDismissed(true)}
        onBlur={() => setDismissed(false)}
        className="inline-flex items-center gap-2 rounded-sm text-sm text-ink-soft hover:text-ink"
      >
        <span className="font-semibold">Relevance</span>
        <span className="font-mono text-ink">{value}</span>
        <span aria-hidden="true" className="h-1.5 w-12 overflow-hidden rounded-full bg-rule">
          <span className="block h-full bg-park" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        </span>
      </button>
      <span
        role="tooltip"
        id={id}
        className={`pointer-events-none absolute bottom-full left-0 z-30 mb-2 w-72 max-w-[80vw] rounded bg-ink px-3 py-2 text-sm text-white opacity-0 transition-opacity ${
          dismissed ? "" : "group-hover:opacity-100 group-focus-within:opacity-100"
        }`}
      >
        {reason}
      </span>
    </span>
  );
}

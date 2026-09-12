"use client";

import { useState } from "react";

/** Monospace agenda reference; click to copy. */
export function ItemRef({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked; the reference stays visible and selectable.
    }
  }

  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        onClick={copy}
        aria-label={`Agenda item ${value}. Copy reference`}
        className="inline-flex items-center gap-1.5 rounded-sm font-mono text-sm text-ink-soft hover:text-ink"
      >
        {value}
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
          {copied ? (
            <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" />
          ) : (
            <path d="M5.5 5.5V3h7.5v7.5h-2.5M3 5.5h7.5V13H3z" fill="none" stroke="currentColor" strokeWidth="1.4" />
          )}
        </svg>
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? `Copied ${value}` : ""}
      </span>
    </span>
  );
}

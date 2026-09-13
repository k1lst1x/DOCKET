"use client";

import { CHART_INK, VOTE_COLORS } from "./palette";

export interface BarRow {
  key: string;
  label: string;
  value: number;
}

interface BarListProps {
  rows: BarRow[];
  color?: string;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  disabled?: boolean;
}

/** One-series horizontal bars; value and share sit beside each label. Rows become buttons when votable. */
export function BarList({ rows, color = VOTE_COLORS.support, selectedKey = null, onSelect, disabled = false }: BarListProps) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <ul className="grid gap-1.5">
      {rows.map((row) => {
        const selected = row.key === selectedKey;
        const share = total ? Math.round((row.value / total) * 100) : 0;
        const width = row.value ? Math.max((row.value / max) * 100, 3) : 0;
        const content = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-2 text-base text-ink">
                {selected ? (
                  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0">
                    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                ) : null}
                {row.label}
                {selected ? <span className="sr-only"> (your choice)</span> : null}
              </span>
              <span className="shrink-0 text-sm tabular-nums text-ink-soft">
                <span className="font-semibold text-ink">{row.value}</span> · {share}%
              </span>
            </span>
            <span aria-hidden="true" className="mt-2 block h-2.5 w-full overflow-hidden rounded-full" style={{ background: CHART_INK.track }}>
              <span className="block h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${width}%`, background: color }} />
            </span>
          </>
        );
        return (
          <li key={row.key}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(row.key)}
                disabled={disabled}
                aria-pressed={selected}
                className={`block w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-sky-mist disabled:cursor-not-allowed disabled:opacity-70 ${
                  selected ? "bg-sky-mist ring-1 ring-inset ring-ink/20" : ""
                }`}
              >
                {content}
              </button>
            ) : (
              <div className="px-3 py-2">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

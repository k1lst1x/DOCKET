"use client";

import { useState } from "react";
import { CHART_INK } from "./palette";

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

const pct = (value: number, total: number) => (total ? `${Math.round((value / total) * 100)}%` : "0%");

/** Part-to-whole ring (≤3 segments here) with the total in the middle and a legend that always shows numbers. */
export function Donut({ segments, title, size = 176, thickness = 22 }: { segments: DonutSegment[]; title: string; size?: number; thickness?: number }) {
  const [active, setActive] = useState<string | null>(null);
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const visible = segments.filter((s) => s.value > 0);
  const gap = visible.length > 1 ? 4 : 0;
  const starts = visible.map((_, i) => visible.slice(0, i).reduce((s, x) => s + (x.value / total) * circumference, 0));
  const focus = segments.find((s) => s.key === active) ?? null;

  return (
    <figure className="flex flex-col items-center gap-5 sm:flex-row sm:gap-8">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          role="img"
          aria-label={`${title}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}
        >
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={CHART_INK.track} strokeWidth={thickness} />
          {total > 0
            ? visible.map((s, i) => {
                const length = (s.value / total) * circumference;
                const dash = Math.max(length - gap, 0.5);
                const dimmed = active !== null && active !== s.key;
                return (
                  <circle
                    key={s.key}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={dimmed ? thickness - 8 : thickness}
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={-starts[i]}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    onPointerEnter={() => setActive(s.key)}
                    onPointerLeave={() => setActive(null)}
                    style={{ transition: "stroke-width 150ms ease" }}
                  />
                );
              })
            : null}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[2rem] font-semibold leading-none text-ink">{focus ? pct(focus.value, total) : total}</p>
            <p className="mt-1 text-sm text-ink-muted">{focus ? focus.label : total === 1 ? "vote" : "votes"}</p>
          </div>
        </div>
      </div>
      <figcaption className="sr-only">{title}</figcaption>
      <ul className="grid w-full gap-1.5">
        {segments.map((s) => (
          <li
            key={s.key}
            onPointerEnter={() => setActive(s.key)}
            onPointerLeave={() => setActive(null)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${active === s.key ? "bg-sky-mist" : ""}`}
          >
            <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="flex-1 text-base text-ink">{s.label}</span>
            <span className="font-semibold tabular-nums text-ink">{s.value}</span>
            <span className="w-12 text-right text-sm tabular-nums text-ink-muted">{pct(s.value, total)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

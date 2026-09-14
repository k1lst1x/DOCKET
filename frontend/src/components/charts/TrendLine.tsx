"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { TrendPoint } from "@/lib/issue-types";
import { formatMonthDay } from "@/lib/format";
import { CHART_INK, VOTE_COLORS } from "./palette";

const SERIES = [
  { key: "support", label: "Support", color: VOTE_COLORS.support },
  { key: "oppose", label: "Oppose", color: VOTE_COLORS.oppose },
] as const;

function niceMax(value: number) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= value) ?? 10;
  return step * magnitude;
}

const dayLabel = (day: string) => formatMonthDay(`${day}T12:00:00-07:00`);

/** Cumulative support vs oppose by day. Crosshair + readout on hover or arrow keys. */
export function TrendLine({ points }: { points: TrendPoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (points.length < 2) {
    return <p className="text-base text-ink-muted">A trend appears once votes have come in over at least two days.</p>;
  }

  const height = 200;
  const pad = { left: 34, right: 88, top: 14, bottom: 30 };
  const innerW = Math.max(width - pad.left - pad.right, 40);
  const innerH = height - pad.top - pad.bottom;
  const maxY = niceMax(Math.max(...points.map((p) => Math.max(p.support, p.oppose))));
  const x = (i: number) => pad.left + (i / (points.length - 1)) * innerW;
  const y = (v: number) => pad.top + innerH - (v / maxY) * innerH;
  const last = points.length - 1;
  const active = index === null ? null : points[index];

  const pick = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = (clientX - rect.left - pad.left) / innerW;
    setIndex(Math.min(last, Math.max(0, Math.round(ratio * last))));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") setIndex((i) => Math.min(last, (i ?? -1) + 1));
    else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, (i ?? last + 1) - 1));
    else if (e.key === "Escape") setIndex(null);
    else return;
    e.preventDefault();
  };

  return (
    <div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <div
        ref={wrapRef}
        tabIndex={0}
        role="img"
        aria-label={`Votes over time: ${points
          .map((p) => `${dayLabel(p.day)} support ${p.support}, oppose ${p.oppose}`)
          .join("; ")}`}
        onKeyDown={onKey}
        onBlur={() => setIndex(null)}
        onPointerMove={(e: PointerEvent<HTMLDivElement>) => pick(e.clientX)}
        onPointerLeave={() => setIndex(null)}
        className="relative mt-3 rounded-xl"
        style={{ height }}
      >
        {width > 0 ? (
          <svg width={width} height={height} aria-hidden="true" className="block">
            {[0, maxY / 2, maxY].map((tick) => (
              <g key={tick}>
                <line x1={pad.left} x2={pad.left + innerW} y1={y(tick)} y2={y(tick)} strokeWidth={1} style={{ stroke: CHART_INK.grid }} />
                <text x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={14} style={{ fill: CHART_INK.axis, fontVariantNumeric: "tabular-nums" }}>
                  {Math.round(tick)}
                </text>
              </g>
            ))}
            <text x={pad.left} y={height - 6} fontSize={14} style={{ fill: CHART_INK.axis }}>
              {dayLabel(points[0].day)}
            </text>
            <text x={pad.left + innerW} y={height - 6} fontSize={14} textAnchor="end" style={{ fill: CHART_INK.axis }}>
              {dayLabel(points[last].day)}
            </text>
            {active ? <line x1={x(index ?? 0)} x2={x(index ?? 0)} y1={pad.top} y2={pad.top + innerH} strokeWidth={1} style={{ stroke: CHART_INK.axis }} /> : null}
            {SERIES.map((s) => (
              <g key={s.key}>
                <path
                  d={points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p[s.key])}`).join(" ")}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <circle cx={x(last)} cy={y(points[last][s.key])} r={4.5} fill={s.color} strokeWidth={2} style={{ stroke: CHART_INK.halo }} />
                {active ? <circle cx={x(index ?? 0)} cy={y(active[s.key])} r={4.5} fill={s.color} strokeWidth={2} style={{ stroke: CHART_INK.halo }} /> : null}
              </g>
            ))}
            {SERIES.map((s, i) => {
              const a = y(points[last].support);
              const b = y(points[last].oppose);
              const tooClose = Math.abs(a - b) < 20;
              const labelY = tooClose ? (i === 0 ? Math.min(a, b) - 10 : Math.max(a, b) + 10) : y(points[last][s.key]);
              return (
                <text key={s.key} x={x(last) + 12} y={labelY} dy="0.32em" fontSize={14} style={{ fill: CHART_INK.label }}>
                  {s.label} <tspan fontWeight={600}>{points[last][s.key]}</tspan>
                </text>
              );
            })}
          </svg>
        ) : null}
        {active && index !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 w-40 rounded-xl border border-rule bg-white px-3 py-2 text-sm shadow-[0_8px_24px_rgba(38,38,38,0.12)]"
            style={{ left: Math.min(Math.max(x(index) - 80, 0), Math.max(width - 160, 0)) }}
          >
            <p className="text-ink-muted">{dayLabel(active.day)}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-ink-soft">
                  <span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="font-semibold tabular-nums text-ink">{active[s.key]}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

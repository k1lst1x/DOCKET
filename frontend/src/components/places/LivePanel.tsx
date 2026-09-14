"use client";

import { useEffect, useState } from "react";
import { kmFromFremont } from "@/lib/live/parsers";
import { LIVE_KINDS, liveKindInfo, type AlertSeverity, type LiveAlert, type LiveIncident, type LiveKind } from "@/lib/live/types";
import { neighborhoodAt } from "@/lib/places";
import { FREMONT_CENTER } from "@/lib/live/parsers";
import type { LiveState } from "./useLiveIncidents";

// "Live now" tab on the Places page: disaster and weather alerts, then live incidents by type.

const PACIFIC = "America/Los_Angeles";

export function timeAgo(iso: string | null, now: number): string {
  if (!iso) return "Time unknown";
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: PACIFIC }).format(new Date(iso));
}

export const clock = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: PACIFIC }).format(new Date(iso));

export function whereFromFremont(incident: { lat: number; lng: number }): string {
  const hood = neighborhoodAt(incident.lng, incident.lat);
  if (hood) return `In ${hood.name}`;
  const km = kmFromFremont(incident.lat, incident.lng);
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(incident.lng - FREMONT_CENTER.lng)) * Math.cos(toRad(incident.lat));
  const x =
    Math.cos(toRad(FREMONT_CENTER.lat)) * Math.sin(toRad(incident.lat)) -
    Math.sin(toRad(FREMONT_CENTER.lat)) * Math.cos(toRad(incident.lat)) * Math.cos(toRad(incident.lng - FREMONT_CENTER.lng));
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(bearing / 45) % 8];
  return km < 1 ? "Near Fremont" : `${Math.round(km)} km ${compass} of Fremont`;
}

const ENDS_LABEL: Record<LiveKind, string> = {
  traffic: "Expected to clear",
  closure: "Scheduled to reopen",
  quake: "",
  fire: "",
  outage: "Estimated restoration",
};

const ALERT_STYLE: Record<AlertSeverity, string> = {
  Extreme: "border-signal bg-signal text-white",
  Severe: "border-signal bg-signal-wash text-signal",
  Moderate: "border-ochre bg-ochre-wash text-ochre",
  Minor: "border-rule bg-white text-ink",
  Unknown: "border-rule bg-white text-ink",
};

/** Map pin for an incident: rounded square (places are round), pulsing while recent. */
export function livePin(incident: LiveIncident, selected: boolean, now: number): HTMLElement {
  const info = liveKindInfo(incident.kind);
  const size = incident.kind === "quake" && incident.magnitude !== null ? Math.round(26 + Math.max(0, incident.magnitude) * 4) : 32;
  const box = selected ? size + 10 : size;
  const pin = document.createElement("div");
  Object.assign(pin.style, {
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: `${box}px`,
    height: `${box}px`,
    fontSize: `${Math.round(box * 0.5)}px`,
    lineHeight: "1",
    borderRadius: "10px",
    background: selected ? "#262626" : "#ffffff",
    border: `3px solid ${selected ? "#ffffff" : info.color}`,
    boxShadow: selected ? `0 0 0 3px ${info.color}, 0 6px 16px rgba(0,0,0,.35)` : "0 2px 8px rgba(0,0,0,.3)",
  });
  pin.textContent = info.icon;
  const recent = incident.startedAt && now - Date.parse(incident.startedAt) < 30 * 60_000;
  const calm = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (recent && !calm) {
    const ring = document.createElement("span");
    Object.assign(ring.style, { position: "absolute", inset: "-5px", borderRadius: "12px", border: `3px solid ${info.color}`, pointerEvents: "none" });
    pin.append(ring);
    ring.animate([{ transform: "scale(0.9)", opacity: 0.9 }, { transform: "scale(1.6)", opacity: 0 }], { duration: 1600, iterations: Infinity, easing: "ease-out" });
  }
  return pin;
}

interface LivePanelProps {
  live: LiveState & { refresh: () => void };
  kinds: Set<LiveKind>;
  onToggleKind: (kind: LiveKind) => void;
  showOnMap: boolean;
  onShowOnMap: (show: boolean) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Opens the incident in its own popup. */
  onOpen?: (incident: LiveIncident) => void;
}

export function LivePanel({ live, kinds, onToggleKind, showOnMap, onShowOnMap, selectedId, onSelect, onOpen }: LivePanelProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const snapshot = live.snapshot;
  const incidents = (snapshot?.incidents ?? []).filter((i) => kinds.has(i.kind));
  const counts = new Map<LiveKind, number>();
  for (const i of snapshot?.incidents ?? []) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  const failing = (snapshot?.feeds ?? []).filter((f) => !f.ok);
  const updatedSeconds = live.lastUpdated ? Math.max(0, Math.round((now - live.lastUpdated) / 1000)) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <span aria-hidden="true" className="relative flex h-2.5 w-2.5">
            {live.status === "live" ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d93025] opacity-60" /> : null}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${live.status === "live" ? "bg-[#d93025]" : "bg-ink-muted"}`} />
          </span>
          {live.status === "loading"
            ? "Connecting to live feeds…"
            : live.status === "error"
              ? "Live feeds are unavailable"
              : `Live · updated ${updatedSeconds !== null && updatedSeconds < 10 ? "just now" : updatedSeconds !== null && updatedSeconds < 60 ? `${updatedSeconds}s ago` : timeAgo(live.lastUpdated ? new Date(live.lastUpdated).toISOString() : null, now).toLowerCase()}`}
        </p>
        <button type="button" onClick={live.refresh} disabled={live.refreshing} className="link text-sm disabled:opacity-60">
          {live.refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p className="mt-0.5 text-sm text-ink-muted">Checks for new incidents every minute while this page is open.</p>

      {snapshot ? <AlertList alerts={snapshot.alerts} now={now} /> : null}

      <div role="group" aria-label="Live incident types" className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
        {LIVE_KINDS.map((k) => {
          const active = kinds.has(k.kind);
          return (
            <button
              key={k.kind}
              type="button"
              aria-pressed={active}
              onClick={() => onToggleKind(k.kind)}
              className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${
                active ? "border-ink bg-ink text-white" : "border-rule bg-white text-ink hover:border-ink/40"
              }`}
            >
              <span aria-hidden="true">{k.icon}</span>
              {k.label}
              <span className={`rounded-full px-1.5 font-mono text-xs ${active ? "bg-white/20" : "bg-sky-mist"}`}>{counts.get(k.kind) ?? 0}</span>
            </button>
          );
        })}
      </div>
      <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" checked={showOnMap} onChange={(e) => onShowOnMap(e.target.checked)} className="h-4 w-4 accent-ink" />
        Show live incidents on the map
      </label>

      {live.status === "loading" && !snapshot ? (
        <ul aria-hidden="true" className="mt-3 grid gap-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-16 animate-pulse rounded-2xl bg-white" />
          ))}
        </ul>
      ) : null}

      {snapshot && incidents.length === 0 ? (
        <p className="mt-3 rounded-2xl bg-white p-4 text-base text-ink-soft">
          {kinds.size === 0 ? "Pick an incident type to see what's happening." : "Nothing active right now for the types you picked. Good news."}
        </p>
      ) : null}

      {incidents.length ? (
        <ul className="mt-3 grid gap-2">
          {incidents.map((incident) => {
            const info = liveKindInfo(incident.kind);
            const selected = incident.id === selectedId;
            return (
              <li key={incident.id} className="min-w-0">
                <button
                  id={`live-${incident.id}`}
                  type="button"
                  aria-expanded={selected}
                  onClick={() => onSelect(selected ? null : incident.id)}
                  className={`flex w-full min-w-0 items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition-colors ${
                    selected ? "border-ink bg-white shadow-sm" : "border-transparent bg-white hover:border-ink/25"
                  }`}
                >
                  <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-sky-mist text-lg" style={{ boxShadow: `inset 0 0 0 2px ${info.color}` }}>
                    {info.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2">
                      <span className="font-semibold leading-snug text-ink">{incident.title}</span>
                      {incident.severity === "severe" ? <span className="rounded-full bg-signal-wash px-2 text-xs font-semibold text-signal">Serious</span> : null}
                    </span>
                    {incident.subtitle ? <span className="block text-sm text-ink-soft">{incident.subtitle}</span> : null}
                    <span className="mt-0.5 block text-sm text-ink-muted">
                      {timeAgo(incident.startedAt, now)} · {whereFromFremont(incident)}
                    </span>
                  </span>
                </button>
                {selected ? (
                  <div className="mx-1 -mt-2 rounded-b-2xl border border-t-0 border-ink bg-white px-3.5 pb-4 pt-4 text-sm text-ink-soft">
                    {incident.startedAt ? <p>Started {clock(incident.startedAt)}</p> : null}
                    {incident.updatedAt ? <p>Last updated {clock(incident.updatedAt)}</p> : null}
                    {incident.endsAt && ENDS_LABEL[incident.kind] ? (
                      <p>
                        {ENDS_LABEL[incident.kind]}: {clock(incident.endsAt)}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {onOpen ? (
                        <button type="button" aria-haspopup="dialog" onClick={() => onOpen(incident)} className="btn btn-primary h-10 rounded-full px-4 text-sm">
                          Read more
                        </button>
                      ) : null}
                      {incident.sourceUrl ? (
                        <a href={incident.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary h-10 rounded-full px-4 text-sm">
                          View on {incident.sourceName}
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        <p>Source: {incident.sourceName}</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {failing.length && snapshot ? (
        <p role="status" className="mt-3 rounded-2xl bg-ochre-wash p-3 text-sm text-ochre">
          {failing
            .map((f) => (f.fetchedAt ? `${f.name} isn't responding; showing its update from ${timeAgo(f.fetchedAt, now).toLowerCase()}` : `${f.name} isn't responding right now`))
            .join(". ")}
          .
        </p>
      ) : null}
      {live.mode === "browser" ? (
        <p className="mt-3 text-sm text-ink-muted">This preview shows earthquakes, weather alerts and power outages. The full site adds CHP incidents, road closures and wildfires.</p>
      ) : null}

      <p className="mt-4 text-sm text-ink-muted">
        Sources: CHP live incident log (freeways and highways), Caltrans lane closures, USGS earthquakes within 150 km, CAL FIRE incidents within 200 km,
        California&apos;s power outage map and National Weather Service alerts. Fremont Police and Fire don&apos;t publish live calls; for police alerts follow{" "}
        <a href="https://local.nixle.com/fremont-police-department-ca/" target="_blank" rel="noopener noreferrer" className="underline">
          Fremont PD on Nixle
        </a>
        . Call 911 in an emergency.
      </p>
    </div>
  );
}

function AlertList({ alerts, now }: { alerts: LiveAlert[]; now: number }) {
  if (!alerts.length) {
    return <p className="mt-3 rounded-2xl bg-white p-3 text-sm text-ink-soft">No weather or disaster alerts for Fremont right now.</p>;
  }
  return (
    <ul aria-label="Alerts for Fremont" className="mt-3 grid gap-2">
      {alerts.map((alert) => (
        <li key={alert.id} className={`rounded-2xl border p-3.5 ${ALERT_STYLE[alert.severity]}`}>
          <p className="font-semibold">
            <span aria-hidden="true">⚠️ </span>
            {alert.event}
          </p>
          <p className="mt-0.5 text-sm opacity-90">
            {alert.endsAt ? `Until ${clock(alert.endsAt)}` : "Until further notice"}
            {alert.effective ? ` · issued ${timeAgo(alert.effective, now).toLowerCase()}` : ""}
          </p>
          {alert.description || alert.instruction ? (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer font-semibold underline">Read the alert</summary>
              {alert.description ? <p className="mt-2 whitespace-pre-line">{alert.description}</p> : null}
              {alert.instruction ? <p className="mt-2 whitespace-pre-line font-semibold">{alert.instruction}</p> : null}
              {alert.sourceUrl ? (
                <a href={alert.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block underline">
                  National Weather Service forecast for Fremont
                </a>
              ) : null}
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

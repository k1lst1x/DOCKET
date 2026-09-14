// Live incidents and alerts around Fremont, normalized from public real-time feeds.

export type LiveKind = "traffic" | "closure" | "quake" | "fire" | "outage" | "report";
export type LiveSeverity = "minor" | "moderate" | "severe";

export interface LiveIncident {
  id: string;
  kind: LiveKind;
  title: string;
  subtitle: string | null;
  severity: LiveSeverity;
  lat: number;
  lng: number;
  startedAt: string | null;
  updatedAt: string | null;
  /** Expected reopening, restoration or end, when the source gives one. */
  endsAt: string | null;
  /** Magnitude for earthquakes, acres for fires, customers for outages. */
  magnitude: number | null;
  sourceName: string;
  sourceUrl: string | null;
}

export type AlertSeverity = "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";

export interface LiveAlert {
  id: string;
  event: string;
  headline: string | null;
  severity: AlertSeverity;
  urgency: string | null;
  effective: string | null;
  endsAt: string | null;
  areaDesc: string | null;
  description: string | null;
  instruction: string | null;
  sourceUrl: string | null;
  /** Who issued it; treated as the National Weather Service when missing. */
  sourceName?: string;
}

export const alertSourceName = (alert: Pick<LiveAlert, "sourceName">) => alert.sourceName ?? "National Weather Service";

export type FeedId = "chp" | "closures" | "quakes" | "fires" | "outages" | "alerts" | "reports" | "bart";

export interface FeedStatus {
  id: FeedId;
  name: string;
  ok: boolean;
  /** Last time the feed answered successfully. */
  fetchedAt: string | null;
  error: string | null;
  count: number;
}

export interface LiveSnapshot {
  generatedAt: string;
  incidents: LiveIncident[];
  alerts: LiveAlert[];
  feeds: FeedStatus[];
}

export const LIVE_KINDS: { kind: LiveKind; label: string; icon: string; color: string }[] = [
  { kind: "traffic", label: "CHP incidents", icon: "🚨", color: "#b91c1c" },
  { kind: "closure", label: "Road closures", icon: "🚧", color: "#c2410c" },
  { kind: "quake", label: "Earthquakes", icon: "🌎", color: "#6d28d9" },
  { kind: "fire", label: "Wildfires", icon: "🔥", color: "#dc2626" },
  { kind: "outage", label: "Power outages", icon: "⚡", color: "#a16207" },
  { kind: "report", label: "Resident reports", icon: "📣", color: "#0e7490" },
];

export const liveKindInfo = (kind: LiveKind) => LIVE_KINDS.find((k) => k.kind === kind) ?? LIVE_KINDS[0];

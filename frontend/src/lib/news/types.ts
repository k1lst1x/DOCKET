import type { AlertSeverity, LiveAlert, LiveKind } from "../live/types";

// The Fremont news page: articles, community posts and live incidents, each tagged with the
// neighborhoods it names, so the page can search, sort and filter one combined list.

export type NewsCategory = "safety" | "disaster" | "traffic" | "housing" | "cityhall" | "community";

export const NEWS_CATEGORIES: { id: NewsCategory; label: string; icon: string; color: string }[] = [
  { id: "safety", label: "Police & crime", icon: "🚓", color: "#b91c1c" },
  { id: "disaster", label: "Fire & disasters", icon: "🔥", color: "#c2410c" },
  { id: "traffic", label: "Traffic", icon: "🚗", color: "#4338ca" },
  { id: "housing", label: "Housing & homes", icon: "🏠", color: "#0f766e" },
  { id: "cityhall", label: "City hall", icon: "🏛️", color: "#334155" },
  { id: "community", label: "Community", icon: "🎉", color: "#2f6a31" },
];

export const newsCategoryInfo = (id: NewsCategory) => NEWS_CATEGORIES.find((c) => c.id === id) ?? NEWS_CATEGORIES[NEWS_CATEGORIES.length - 1];

export type NewsKind = "article" | "community" | "incident";

export const NEWS_KINDS: { id: NewsKind; label: string }[] = [
  { id: "article", label: "Articles" },
  { id: "community", label: "Community posts" },
  { id: "incident", label: "Live incidents" },
];

export interface NewsItem {
  id: string;
  title: string;
  /** Link to the story or the incident's official source, when there is one. */
  url: string | null;
  source: string;
  publishedAt: string | null;
  snippet: string | null;
  category: NewsCategory;
  /** Docket neighborhood groups the item names or happens in; empty for Fremont-wide items. */
  neighborhoods: string[];
  kind: NewsKind;
  /** Live incidents only. */
  severity: "minor" | "moderate" | "severe" | null;
  /** Where and how long, for live incidents; shown in the story popup. */
  incident?: NewsIncidentDetails | null;
  /** Weather and disaster alerts only. */
  alert?: NewsAlertDetails | null;
}

export interface NewsIncidentDetails {
  kind: LiveKind;
  lat: number;
  lng: number;
  updatedAt: string | null;
  endsAt: string | null;
  /** Magnitude for earthquakes, acres for fires, customers for outages. */
  magnitude: number | null;
}

export interface NewsAlertDetails {
  severity: AlertSeverity;
  endsAt: string | null;
  areaDesc: string | null;
  description: string | null;
  instruction: string | null;
}

export interface NewsSourceStatus {
  key: string;
  name: string;
  ok: boolean;
  count: number;
  fetchedAt: string | null;
  error: string | null;
}

export interface NewsCatalog {
  generatedAt: string;
  items: NewsItem[];
  alerts: LiveAlert[];
  /** The neighborhoods items can be filtered by. */
  neighborhoods: string[];
  sources: NewsSourceStatus[];
}

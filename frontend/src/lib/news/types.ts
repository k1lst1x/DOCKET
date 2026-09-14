import type { IssueMarker } from "../issue-types";
import type { LiveAlert, LiveIncident } from "../live/types";

// Neighborhood news pages: articles and community posts about a neighborhood, plus live incidents,
// alerts and city issues for the same area.

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

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  snippet: string | null;
  category: NewsCategory;
  /** Mentions the neighborhood by name (or a landmark in it), rather than Fremont in general. */
  inNeighborhood: boolean;
  kind: "article" | "community";
}

export interface NewsSourceStatus {
  key: string;
  name: string;
  ok: boolean;
  count: number;
  fetchedAt: string | null;
  error: string | null;
}

export interface NewsSnapshot {
  generatedAt: string;
  group: { slug: string; name: string; district: string };
  items: NewsItem[];
  incidents: LiveIncident[];
  alerts: LiveAlert[];
  issues: IssueMarker[];
  /** False when issue vote totals couldn't be read from the database. */
  issuesLive: boolean;
  sources: NewsSourceStatus[];
}

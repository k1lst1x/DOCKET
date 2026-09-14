import { alertSourceName, type LiveAlert, type LiveIncident } from "../live/types";
import { neighborhoodAt } from "../places";
import type { NewsCategory, NewsItem } from "./types";

// Live incidents (CHP, closures, outages, wildfires, earthquakes) as news items, so the news page
// can list, search and filter them alongside articles. Each is tagged with the Fremont neighborhood
// it's in (any of the 32), so every neighborhood group page can show its own incidents.

const CATEGORY: Record<LiveIncident["kind"], NewsCategory> = {
  traffic: "traffic",
  closure: "traffic",
  quake: "disaster",
  fire: "disaster",
  outage: "disaster",
  report: "community",
};

/** Resident reports stay on the map for a month; the news list only carries the last few days. */
export const REPORT_NEWS_MS = 3 * 86_400_000;

/**
 * Small earthquakes stay on the Places map; the news list only carries ones people might feel.
 * Takes one argument on purpose (it's passed straight to Array.filter), so reports use the clock.
 */
export const newsworthyIncident = (incident: LiveIncident) => {
  if (incident.kind === "quake") return (incident.magnitude ?? 0) >= 2.5;
  if (incident.kind === "report") return !!incident.startedAt && Date.now() - Date.parse(incident.startedAt) <= REPORT_NEWS_MS;
  return true;
};

export function incidentToNewsItem(incident: LiveIncident): NewsItem {
  const neighborhood = neighborhoodAt(incident.lng, incident.lat)?.name;
  return {
    id: `live:${incident.id}`,
    title: incident.title,
    url: incident.sourceUrl,
    source: incident.sourceName,
    publishedAt: incident.startedAt,
    snippet: incident.subtitle,
    category: CATEGORY[incident.kind],
    neighborhoods: neighborhood ? [neighborhood] : [],
    kind: "incident",
    severity: incident.severity,
    incident: { kind: incident.kind, lat: incident.lat, lng: incident.lng, updatedAt: incident.updatedAt, endsAt: incident.endsAt, magnitude: incident.magnitude },
  };
}

/** A weather, disaster or BART alert in the same shape, so it opens in the same popup. */
export function alertToNewsItem(alert: LiveAlert): NewsItem {
  const source = alertSourceName(alert);
  return {
    id: `alert:${alert.id}`,
    title: alert.event,
    url: alert.sourceUrl,
    source,
    publishedAt: alert.effective,
    snippet: alert.headline,
    category: source === "BART" ? "traffic" : "disaster",
    neighborhoods: [],
    kind: "incident",
    severity: alert.severity === "Extreme" || alert.severity === "Severe" ? "severe" : alert.severity === "Moderate" ? "moderate" : "minor",
    alert: { severity: alert.severity, endsAt: alert.endsAt, areaDesc: alert.areaDesc, description: alert.description, instruction: alert.instruction },
  };
}

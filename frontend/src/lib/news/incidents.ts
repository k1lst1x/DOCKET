import type { LiveIncident } from "../live/types";
import { neighborhoodAt } from "../places";
import { DISTRICT_ALIASES } from "./parse";
import type { NewsCategory, NewsItem } from "./types";

// Live incidents (CHP, closures, outages, wildfires, earthquakes) as news items, so the news page
// can list, search and filter them alongside articles.

const DISTRICTS = new Set(Object.keys(DISTRICT_ALIASES));

const CATEGORY: Record<LiveIncident["kind"], NewsCategory> = {
  traffic: "traffic",
  closure: "traffic",
  quake: "disaster",
  fire: "disaster",
  outage: "disaster",
};

/** Small earthquakes stay on the Places map; the news list only carries ones people might feel. */
export const newsworthyIncident = (incident: LiveIncident) => incident.kind !== "quake" || (incident.magnitude ?? 0) >= 2.5;

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
    neighborhoods: neighborhood && DISTRICTS.has(neighborhood) ? [neighborhood] : [],
    kind: "incident",
    severity: incident.severity,
  };
}

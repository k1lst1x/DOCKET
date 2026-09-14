import { distanceToPolygonKm } from "../geo";
import type { LiveIncident } from "../live/types";
import type { LngLat } from "../types";

/**
 * Live incidents that matter to a neighborhood: road, traffic and outage incidents within 2 km of
 * its boundary, wildfires within 80 km, and earthquakes within 30 km or strong enough (M3.5+) to feel.
 */
export function incidentNearBoundary(incident: LiveIncident, boundary: LngLat[]): boolean {
  const km = distanceToPolygonKm([incident.lng, incident.lat], boundary);
  if (incident.kind === "quake") return km <= 30 || (incident.magnitude ?? 0) >= 3.5;
  if (incident.kind === "fire") return km <= 80;
  return km <= 2;
}

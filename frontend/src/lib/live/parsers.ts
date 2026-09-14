import { haversineKm } from "../geo";
import { FREMONT } from "../places";
import type { AlertSeverity, LiveAlert, LiveIncident, LiveSeverity } from "./types";

// Pure parsers for each public feed, shared by the server route and the browser fallback.

export const FREMONT_CENTER = FREMONT.center;

/** Fremont plus about 8 km on every side, for road, traffic and outage feeds. */
const PAD_DEG = 0.08;
export const NEARBY_BOUNDS = {
  north: FREMONT.bounds.north + PAD_DEG,
  south: FREMONT.bounds.south - PAD_DEG,
  east: FREMONT.bounds.east + PAD_DEG,
  west: FREMONT.bounds.west - PAD_DEG,
};
export const QUAKE_RADIUS_KM = 150;
/** Small quakes are constant background noise; show them only close to Fremont. */
const QUAKE_NEARBY_KM = 40;
const QUAKE_NOTABLE_MAG = 2.5;
export const FIRE_RADIUS_KM = 200;

export const inNearbyBounds = (lat: number, lng: number) =>
  lat <= NEARBY_BOUNDS.north && lat >= NEARBY_BOUNDS.south && lng <= NEARBY_BOUNDS.east && lng >= NEARBY_BOUNDS.west;

export const kmFromFremont = (lat: number, lng: number) => haversineKm([FREMONT_CENTER.lng, FREMONT_CENTER.lat], [lng, lat]);

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const isoFromMs = (ms: unknown) => (finite(ms) ? new Date(ms).toISOString() : null);
const isoFromString = (s: unknown) => (typeof s === "string" && s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : null);
const count = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ------------------------------------------------------------------------------------------------
// USGS earthquakes (GeoJSON, updated every minute)

interface UsgsFeature {
  id: string;
  properties?: { mag?: number | null; place?: string | null; time?: number; updated?: number; url?: string };
  geometry?: { coordinates?: number[] } | null;
}

export function parseUsgs(json: unknown): LiveIncident[] {
  const features = (json as { features?: UsgsFeature[] } | null)?.features ?? [];
  return features.flatMap((f) => {
    const [lng, lat] = f.geometry?.coordinates ?? [];
    const mag = f.properties?.mag;
    if (!finite(lat) || !finite(lng) || !finite(mag)) return [];
    const km = kmFromFremont(lat, lng);
    if (km > QUAKE_RADIUS_KM || (mag < QUAKE_NOTABLE_MAG && km > QUAKE_NEARBY_KM)) return [];
    const incident: LiveIncident = {
      id: `quake-${f.id}`,
      kind: "quake",
      title: `M${mag.toFixed(1)} earthquake`,
      subtitle: f.properties?.place ?? null,
      severity: mag >= 4.5 ? "severe" : mag >= 3 ? "moderate" : "minor",
      lat,
      lng,
      startedAt: isoFromMs(f.properties?.time),
      updatedAt: isoFromMs(f.properties?.updated),
      endsAt: null,
      magnitude: mag,
      sourceName: "USGS",
      sourceUrl: f.properties?.url ?? null,
    };
    return [incident];
  });
}

// ------------------------------------------------------------------------------------------------
// CAL FIRE active incidents (GeoJSON)

interface CalFireProps {
  Name?: string;
  Final?: boolean;
  IsActive?: boolean;
  Updated?: string;
  Started?: string;
  ExtinguishedDate?: string;
  County?: string;
  Location?: string;
  AcresBurned?: number | null;
  PercentContained?: number | null;
  Latitude?: number;
  Longitude?: number;
  UniqueId?: string;
  Url?: string;
}

export function parseCalFire(json: unknown): LiveIncident[] {
  const features = (json as { features?: { properties?: CalFireProps }[] } | null)?.features ?? [];
  return features.flatMap(({ properties: p }) => {
    if (!p || p.Final || p.IsActive === false) return [];
    const lat = p.Latitude;
    const lng = p.Longitude;
    if (!finite(lat) || !finite(lng) || kmFromFremont(lat, lng) > FIRE_RADIUS_KM) return [];
    const acres = finite(p.AcresBurned) ? p.AcresBurned : null;
    const contained = finite(p.PercentContained) ? p.PercentContained : null;
    const incident: LiveIncident = {
      id: `fire-${p.UniqueId ?? `${lat},${lng}`}`,
      kind: "fire",
      title: (p.Name ?? "Wildfire").trim(),
      subtitle:
        [
          acres !== null ? `${count(acres)} acres` : null,
          contained !== null ? `${Math.round(contained)}% contained` : null,
          p.County ? `${p.County.trim()} County` : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      severity: acres !== null && acres >= 1000 ? "severe" : acres !== null && acres >= 100 ? "moderate" : "minor",
      lat,
      lng,
      startedAt: isoFromString(p.Started),
      updatedAt: isoFromString(p.Updated),
      endsAt: null,
      magnitude: acres,
      sourceName: "CAL FIRE",
      sourceUrl: p.Url ?? null,
    };
    return [incident];
  });
}

// ------------------------------------------------------------------------------------------------
// CHP live incident log (XML, statewide, times in Pacific time)

const CHP_CODES: Record<string, string> = {
  "1144": "Fatal collision",
  "1179": "Collision, ambulance responding",
  "1180": "Collision, major injuries",
  "1181": "Collision, minor injuries",
  "1182": "Collision, no injuries",
  "1183": "Collision, injuries unknown",
  "1125": "Traffic hazard",
  "1166": "Traffic signal out",
  "20001": "Hit and run, injuries",
  "20002": "Hit and run, no injuries",
  "23114": "Object thrown from vehicle",
};
const CHP_SEVERE = new Set(["1144", "1179", "1180", "20001"]);
const CHP_MODERATE = new Set(["1181", "1183", "1125", "WW", "FIRE", "CFIRE", "SIG"]);
const CHP_WORDS: [RegExp, string][] = [
  [/\btrfc\b/gi, "traffic"],
  [/\bveh\b/gi, "vehicle"],
  [/\binj\b/gi, "injury"],
  [/\bobstr\b/gi, "obstruction"],
  [/\breq\b/gi, "request"],
  [/\bambl?\b/gi, "ambulance"],
  [/\bunkn?\b/gi, "unknown"],
  [/\bped\b/gi, "pedestrian"],
  [/\bconstr\b/gi, "construction"],
  [/\bmaint\b/gi, "maintenance"],
];

export function humanizeChpType(raw: string): { title: string; severity: LiveSeverity } {
  const text = raw.trim();
  const match = text.match(/^([A-Za-z0-9]+)\s*-\s*(.+)$/);
  const code = match?.[1]?.toUpperCase() ?? "";
  let label = CHP_CODES[code] ?? match?.[2] ?? text;
  if (!CHP_CODES[code]) {
    for (const [pattern, word] of CHP_WORDS) label = label.replace(pattern, word);
    label = sentence(label.toLowerCase().replace(/\s*-\s*/g, ", "));
  }
  const severity: LiveSeverity = CHP_SEVERE.has(code) ? "severe" : CHP_MODERATE.has(code) ? "moderate" : "minor";
  return { title: label || "Traffic incident", severity };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(utcMs / 1000) * 1000;
}

/** "Sep 13 2026  6:34AM" in Pacific time, as an ISO timestamp. */
export function pacificTimeToIso(text: string): string | null {
  const m = text.trim().match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  let hour = Number(m[4]) % 12;
  if (m[6].toUpperCase() === "PM") hour += 12;
  const guess = Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5]));
  let utc = guess - timeZoneOffsetMs(guess, "America/Los_Angeles");
  const corrected = guess - timeZoneOffsetMs(utc, "America/Los_Angeles");
  if (corrected !== utc) utc = corrected;
  return new Date(utc).toISOString();
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => XML_ENTITIES[name]).replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));

const CHP_FIELDS = {
  logTime: /<LogTime>([\s\S]*?)<\/LogTime>/,
  logType: /<LogType>([\s\S]*?)<\/LogType>/,
  location: /<Location>([\s\S]*?)<\/Location>/,
  area: /<Area>([\s\S]*?)<\/Area>/,
  latLon: /<LATLON>([\s\S]*?)<\/LATLON>/,
};
const field = (block: string, pattern: RegExp) => decodeXml(block.match(pattern)?.[1] ?? "").replace(/^\s*"|"\s*$/g, "").trim();

export function parseChpXml(xml: string): LiveIncident[] {
  const incidents: LiveIncident[] = [];
  for (const match of xml.matchAll(/<Log ID\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\/Log>/g)) {
    const [, id, block] = match;
    const coords = field(block, CHP_FIELDS.latLon).match(/^(\d+):(\d+)$/);
    if (!coords) continue;
    const lat = Number(coords[1]) / 1e6;
    const lng = -Number(coords[2]) / 1e6;
    if (!inNearbyBounds(lat, lng)) continue;
    const { title, severity } = humanizeChpType(field(block, CHP_FIELDS.logType));
    const location = field(block, CHP_FIELDS.location);
    const area = field(block, CHP_FIELDS.area);
    incidents.push({
      id: `chp-${id}`,
      kind: "traffic",
      title,
      subtitle: [location, area ? `CHP ${area}` : null].filter(Boolean).join(" · ") || null,
      severity,
      lat,
      lng,
      startedAt: pacificTimeToIso(field(block, CHP_FIELDS.logTime)),
      updatedAt: null,
      endsAt: null,
      magnitude: null,
      sourceName: "CHP",
      sourceUrl: "https://cad.chp.ca.gov/Traffic.aspx",
    });
  }
  return incidents;
}

// ------------------------------------------------------------------------------------------------
// Caltrans District 4 lane closures (JSON)

interface ClosurePoint {
  [key: string]: string | undefined;
}
interface ClosureRecord {
  lcs?: {
    index?: string;
    location?: { travelFlowDirection?: string; begin?: ClosurePoint; end?: ClosurePoint };
    closure?: {
      closureTimestamp?: { closureStartEpoch?: string; closureEndEpoch?: string; isClosureEndIndefinite?: string };
      typeOfClosure?: string;
      typeOfWork?: string;
      lanesClosed?: string;
      totalExistingLanes?: string;
      code1097?: { isCode1097?: string };
      code1098?: { isCode1098?: string };
      code1022?: { isCode1022?: string };
    };
  };
}

export function parseClosures(json: unknown, nowMs: number): LiveIncident[] {
  const records = (json as { data?: ClosureRecord[] } | null)?.data ?? [];
  const nowSec = nowMs / 1000;
  return records.flatMap(({ lcs }) => {
    const closure = lcs?.closure;
    const begin = lcs?.location?.begin;
    const end = lcs?.location?.end;
    if (!lcs?.index || !closure || !begin) return [];
    // 10-97: crew on scene and closure in place. 10-98: closure picked up. 10-22: cancelled.
    if (closure.code1097?.isCode1097 !== "true" || closure.code1098?.isCode1098 === "true" || closure.code1022?.isCode1022 === "true") return [];
    const start = Number(closure.closureTimestamp?.closureStartEpoch);
    const finish = Number(closure.closureTimestamp?.closureEndEpoch);
    const indefinite = closure.closureTimestamp?.isClosureEndIndefinite === "true";
    if (Number.isFinite(start) && start > nowSec) return [];
    if (!indefinite && Number.isFinite(finish) && finish > 0 && finish < nowSec) return [];
    const lat = Number(begin.beginLatitude);
    const lng = Number(begin.beginLongitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inNearbyBounds(lat, lng)) return [];

    const type = (closure.typeOfClosure ?? "Lane").trim();
    const lanes = Number(closure.lanesClosed);
    const total = Number(closure.totalExistingLanes);
    const route = (begin.beginRoute ?? "").trim();
    const direction = (lcs.location?.travelFlowDirection ?? "").replace(/\s*\/\s*/g, "/").trim();
    const places = [begin.beginLocationName, end?.endLocationName].map((s) => s?.trim()).filter(Boolean);
    const severity: LiveSeverity = /full/i.test(type)
      ? "severe"
      : Number.isFinite(lanes) && Number.isFinite(total) && total > 0 && lanes / total >= 0.5
        ? "moderate"
        : "minor";
    const incident: LiveIncident = {
      id: `closure-${lcs.index}`,
      kind: "closure",
      title: `${type} closure${route ? ` · ${route}` : ""}${direction ? ` ${direction}` : ""}`,
      subtitle:
        [
          places.length === 2 && places[0] !== places[1] ? `${places[0]} to ${places[1]}` : (places[0] ?? null),
          closure.typeOfWork?.trim() || null,
          Number.isFinite(lanes) && Number.isFinite(total) && total > 0 ? `${lanes} of ${total} lanes` : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      severity,
      lat,
      lng,
      startedAt: Number.isFinite(start) ? new Date(start * 1000).toISOString() : null,
      updatedAt: null,
      endsAt: !indefinite && Number.isFinite(finish) && finish > 0 ? new Date(finish * 1000).toISOString() : null,
      magnitude: null,
      sourceName: "Caltrans",
      sourceUrl: "https://quickmap.dot.ca.gov/",
    };
    return [incident];
  });
}

// ------------------------------------------------------------------------------------------------
// California power outage incidents (ArcGIS GeoJSON, refreshed every 15 minutes)

interface OutageProps {
  OBJECTID?: number;
  IncidentId?: string | null;
  UtilityCompany?: string | null;
  StartDate?: number | null;
  EstimatedRestoreDate?: number | null;
  Cause?: string | null;
  ImpactedCustomers?: number | null;
  OutageStatus?: string | null;
  OutageType?: string | null;
}

const UTILITIES: Record<string, { name: string; url: string | null }> = {
  PGE: { name: "PG&E", url: "https://pgealerts.alerts.pge.com/outage-tools/outage-map/" },
  SCE: { name: "SCE", url: "https://www.sce.com/outage-center/check-outage-status" },
  SDGE: { name: "SDG&E", url: "https://www.sdge.com/outage-map" },
};

const readableCause = (cause: string) =>
  sentence(
    cause
      .toLowerCase()
      .replace(/\bplnnd\b/g, "planned")
      .replace(/\beqp\b|\bequip\b/g, "equipment")
      .replace(/\s+/g, " ")
      .trim(),
  );

export function parseOutages(json: unknown): LiveIncident[] {
  const features = (json as { features?: { properties?: OutageProps; geometry?: { type?: string; coordinates?: number[] } | null }[] } | null)?.features ?? [];
  return features.flatMap(({ properties: p, geometry }) => {
    const [lng, lat] = geometry?.type === "Point" ? (geometry.coordinates ?? []) : [];
    if (!p || !finite(lat) || !finite(lng) || !inNearbyBounds(lat, lng)) return [];
    if (p.OutageStatus && !/active/i.test(p.OutageStatus)) return [];
    const customers = finite(p.ImpactedCustomers) ? p.ImpactedCustomers : null;
    const utility = UTILITIES[(p.UtilityCompany ?? "").toUpperCase()] ?? { name: p.UtilityCompany ?? "Utility", url: null };
    const incident: LiveIncident = {
      id: `outage-${p.UtilityCompany ?? "utility"}-${p.IncidentId ?? p.OBJECTID ?? `${lat},${lng}`}`,
      kind: "outage",
      title: customers !== null ? `Power outage · ${count(customers)} ${customers === 1 ? "customer" : "customers"}` : "Power outage",
      subtitle: [utility.name, p.OutageType ? `${sentence(p.OutageType.toLowerCase())}` : null, p.Cause ? readableCause(p.Cause) : null]
        .filter(Boolean)
        .join(" · "),
      severity: customers !== null && customers >= 1000 ? "severe" : customers !== null && customers >= 100 ? "moderate" : "minor",
      lat,
      lng,
      startedAt: isoFromMs(p.StartDate),
      updatedAt: null,
      endsAt: isoFromMs(p.EstimatedRestoreDate),
      magnitude: customers,
      sourceName: utility.name,
      sourceUrl: utility.url,
    };
    return [incident];
  });
}

// ------------------------------------------------------------------------------------------------
// National Weather Service active alerts (GeoJSON, zone based)

const ALERT_RANK: Record<AlertSeverity, number> = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };

interface NwsProps {
  id?: string;
  event?: string;
  headline?: string | null;
  severity?: string;
  urgency?: string | null;
  effective?: string | null;
  expires?: string | null;
  ends?: string | null;
  areaDesc?: string | null;
  description?: string | null;
  instruction?: string | null;
  status?: string;
  messageType?: string;
}

/** Most severe first, for alerts from any source. */
export const alertRank = (severity: AlertSeverity) => ALERT_RANK[severity] ?? ALERT_RANK.Unknown;

export function parseNwsAlerts(json: unknown, nowMs: number): LiveAlert[] {
  const features = (json as { features?: { id?: string; properties?: NwsProps }[] } | null)?.features ?? [];
  const seen = new Set<string>();
  const alerts: LiveAlert[] = [];
  for (const f of features) {
    const p = f.properties;
    const id = p?.id ?? f.id;
    if (!p || !id || !p.event || seen.has(id)) continue;
    if (p.status !== "Actual" || p.messageType === "Cancel") continue;
    const endsAt = isoFromString(p.ends) ?? isoFromString(p.expires);
    if (endsAt && Date.parse(endsAt) < nowMs) continue;
    seen.add(id);
    const severity = (Object.hasOwn(ALERT_RANK, p.severity ?? "") ? p.severity : "Unknown") as AlertSeverity;
    alerts.push({
      id,
      event: p.event,
      headline: p.headline ?? null,
      severity,
      urgency: p.urgency ?? null,
      effective: isoFromString(p.effective),
      endsAt,
      areaDesc: p.areaDesc ?? null,
      description: p.description ?? null,
      instruction: p.instruction ?? null,
      sourceUrl: `https://forecast.weather.gov/MapClick.php?lat=${FREMONT_CENTER.lat.toFixed(4)}&lon=${FREMONT_CENTER.lng.toFixed(4)}`,
    });
  }
  return alerts.sort((a, b) => ALERT_RANK[a.severity] - ALERT_RANK[b.severity]);
}

// ------------------------------------------------------------------------------------------------
// Fremont App resident reports (CitySourced service requests, citywide, times in UTC)

const DAY_MS = 86_400_000;
/**
 * Reports filed in the last 7 days, plus older ones still open that the city touched this week. A month
 * of reports put ~170 pins over the whole city and hid the other incidents.
 */
export const REPORT_WINDOW_MS = 7 * DAY_MS;
/** Still open a week after it was filed: shown as moderate so lingering problems stand out. */
const REPORT_STALE_MS = 7 * DAY_MS;
const REPORT_DESCRIPTION_MAX = 120;

interface CitySourcedRecord {
  Id?: string;
  CaseNumber?: string | null;
  CreatedOn?: string | null;
  ModifiedOn?: string | null;
  Description?: string | null;
  Line1?: string | null;
  Latitude?: string | number | null;
  Longitude?: string | number | null;
  ServiceActivityStatus?: unknown;
  ServiceActivityStatusReason?: unknown;
  RequestDetail?: unknown;
}

/** "9/14/2026 5:30:19 PM" in UTC, as an ISO timestamp. */
export function citySourcedTimeToIso(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return null;
  const hour = (Number(m[4]) % 12) + (m[7].toUpperCase() === "PM" ? 12 : 0);
  const ms = Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5]), Number(m[6] ?? 0));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * The English name of a lookup value. The API sends objects ({ NameEN: "Closed" }) but has also sent
 * Python-style reprs ("{'Id': '…', 'NameEN': 'Closed'}"), which switch to double quotes when the
 * name holds an apostrophe ("Other (City Manager's Office)").
 */
export function citySourcedName(value: unknown): string | null {
  if (value && typeof value === "object") {
    const { NameEN, Name } = value as { NameEN?: unknown; Name?: unknown };
    const name = typeof NameEN === "string" && NameEN.trim() ? NameEN : typeof Name === "string" ? Name : "";
    return name.trim() || null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const m = value.match(/['"]NameEN['"]\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/);
  if (m) return (m[1] ?? m[2]).replace(/\\(['"\\])/g, "$1").trim() || null;
  return /^\s*\{/.test(value) ? null : value.trim();
}

const clip = (text: string, max: number) => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
};

/** A short summary of what the resident wrote, with emails and phone numbers removed. */
function reportDescription(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const clean = text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clip(clean, REPORT_DESCRIPTION_MAX) : null;
}

/** City staff log their own cleanups and outreach ("STAFF ENTRY, …"); those aren't resident reports. */
const isStaffEntry = (description: unknown) => typeof description === "string" && /^\s*STAFF\b/i.test(description);

export function parseCitySourced(json: unknown, nowMs: number): LiveIncident[] {
  const records = (json as { Results?: CitySourcedRecord[] } | null)?.Results;
  if (!Array.isArray(records)) return [];
  return records.flatMap((r) => {
    if (!r || typeof r.Id !== "string" || !r.Id || isStaffEntry(r.Description)) return [];
    if (r.Latitude == null || r.Longitude == null || r.Latitude === "" || r.Longitude === "") return [];
    const lat = Number(r.Latitude);
    const lng = Number(r.Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inNearbyBounds(lat, lng)) return [];

    const status = citySourcedName(r.ServiceActivityStatus);
    if (status && /^duplicate/i.test(status)) return [];
    const closed = !!status && /^(closed|cancel)/i.test(status);
    const startedAt = citySourcedTimeToIso(r.CreatedOn);
    const updatedAt = citySourcedTimeToIso(r.ModifiedOn);
    const age = startedAt ? nowMs - Date.parse(startedAt) : Infinity;
    const touched = updatedAt ? nowMs - Date.parse(updatedAt) : Infinity;
    if (!(age <= REPORT_WINDOW_MS || (!closed && touched <= REPORT_WINDOW_MS))) return [];

    const reason = citySourcedName(r.ServiceActivityStatusReason);
    const statusText = status ? (reason && reason.toLowerCase() !== status.toLowerCase() ? `${status} (${clip(reason, 60)})` : status) : null;
    const description = reportDescription(r.Description);
    const incident: LiveIncident = {
      id: `report-${r.Id}`,
      kind: "report",
      title: citySourcedName(r.RequestDetail) ?? "Service request",
      subtitle: [r.Line1?.trim() || null, statusText, r.CaseNumber?.trim() || null, description ? `“${description}”` : null].filter(Boolean).join(" · ") || null,
      severity: !closed && age > REPORT_STALE_MS ? "moderate" : "minor",
      lat,
      lng,
      startedAt,
      updatedAt,
      endsAt: null,
      magnitude: null,
      sourceName: "Fremont App",
      sourceUrl: `https://fremontca.citysourced.com/servicerequests/${encodeURIComponent(r.Id)}`,
    };
    return [incident];
  });
}

// ------------------------------------------------------------------------------------------------
// BART service advisories (JSON converted from XML, times in Pacific time)

/** Stations Fremont riders use. */
export const BART_STATIONS: Record<string, string> = {
  FRMT: "Fremont",
  WARM: "Warm Springs/South Fremont",
  UCTY: "Union City",
  SHAY: "South Hayward",
  BERY: "Berryessa/North San José",
  MLPT: "Milpitas",
};
/** Systemwide advisories count only when they name a Fremont-area station, line or the whole system. */
const BART_RELEVANT =
  /\b(fremont|warm springs|union city|hayward|milpitas|berryessa|orange line|green line|system[\s-]?wide|all stations|all lines|FRMT|WARM|UCTY|SHAY|BERY|MLPT)\b/i;

interface BartItem {
  "@id"?: string;
  station?: string;
  type?: string;
  description?: { "#cdata-section"?: string } | string | null;
  posted?: string;
  expires?: string;
}

const cdata = (value: BartItem["description"]) => (typeof value === "string" ? value : (value?.["#cdata-section"] ?? "")).trim();

/** "Mon Sep 14 2026 06:27 AM PDT" as an ISO timestamp; null for "No time provided." and the like. */
export function bartTimeToIso(text: unknown): string | null {
  if (typeof text !== "string") return null;
  return pacificTimeToIso(
    text
      .trim()
      .replace(/^[A-Za-z]{3,}\s+(?=[A-Za-z]{3}\s)/, "")
      .replace(/\s+P[SD]?T$/i, ""),
  );
}

export function parseBartAdvisories(json: unknown, nowMs: number): LiveAlert[] {
  const raw = (json as { root?: { bsa?: BartItem | BartItem[] } } | null)?.root?.bsa;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const alerts: LiveAlert[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const description = cdata(item?.description);
    if (!description || /^no delays reported/i.test(description)) continue;
    const codes = (item.station ?? "").toUpperCase().split(/[\s,;]+/).filter(Boolean);
    const local = codes.filter((c) => Object.hasOwn(BART_STATIONS, c));
    if (!local.length && !(codes.includes("BART") && BART_RELEVANT.test(description))) continue;
    const endsAt = bartTimeToIso(item.expires);
    if (endsAt && Date.parse(endsAt) < nowMs) continue;
    const id = `bart-${item["@id"] ?? description.slice(0, 40)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const type = (item.type ?? "").toUpperCase();
    alerts.push({
      id,
      event: type === "EMERGENCY" ? "BART emergency" : type === "DELAY" ? "BART delay" : "BART advisory",
      headline: description.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0].trim() ?? description,
      severity: type === "EMERGENCY" ? "Severe" : type === "DELAY" ? "Moderate" : "Minor",
      urgency: null,
      effective: bartTimeToIso(item.posted),
      endsAt,
      areaDesc: local.length ? local.map((c) => BART_STATIONS[c]).join(", ") : "All BART stations",
      description,
      instruction: null,
      sourceUrl: "https://www.bart.gov/schedules/advisories",
      sourceName: "BART",
    });
  }
  return alerts.sort((a, b) => alertRank(a.severity) - alertRank(b.severity));
}

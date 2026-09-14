import { db } from "./db";
import { haversineKm } from "./geo";
import {
  clip,
  field,
  isStaffEntry,
  requestCategory,
  section,
  toAlert,
  toProject,
  toReport,
  withoutNeighborhood,
  type ActivityRow,
  type ProjectKind,
} from "./neighborhood-activity";

// One neighborhood record in full, for its popup: every labeled fact, the resident's or agency's own words,
// mapped points, and the numbers behind the charts (how often this kind of problem comes up here, how the
// city closed them, how a development compares with others nearby, how often an agency posts). Two queries:
// the record's chunks, then its neighborhood's (or agency's) other records for the comparisons.

export const RECORD_SOURCES = {
  "fremont-app-requests-api": "report",
  "fremont-capital-projects-gis": "project",
  "fremont-annual-street-programs-gis": "project",
  "fremont-transportation-projects-gis": "project",
  "fremont-development-activity-gis": "development",
  "fremont-police-nixle": "alert",
  "city-of-fremont-nixle": "alert",
} as const;

export type RecordKind = (typeof RECORD_SOURCES)[keyof typeof RECORD_SOURCES];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecordFact {
  label: string;
  value: string;
}

export interface RecordPoint {
  lat: number;
  lng: number;
  label: string;
}

export interface CountBar {
  label: string;
  value: number;
}

export interface MonthCount {
  /** YYYY-MM */
  month: string;
  value: number;
  /** Same-category (reports) or same-agency (alerts) share of value, when the chart compares two series. */
  highlight?: number;
}

export interface RelatedRecord {
  id: string;
  title: string;
  subtitle: string | null;
  publishedAt: string | null;
}

export interface StreetSegment {
  road: string;
  from: string | null;
  to: string | null;
  work: string | null;
}

export interface RecordDetail {
  id: string;
  kind: RecordKind;
  /** Capital, street, transportation or development, for projects and sites. */
  projectKind: ProjectKind | null;
  sourceId: string;
  title: string;
  url: string;
  publishedAt: string | null;
  neighborhood: string | null;
  status: string | null;
  open: boolean | null;
  body: string | null;
  facts: RecordFact[];
  points: RecordPoint[];
  segments: StreetSegment[];
  links: { label: string; url: string }[];
  charts: {
    /** Reports: requests per month here, with this category highlighted. Alerts: posts per month. */
    monthly: MonthCount[];
    monthlyLabel: string | null;
    /** Reports: how this category's requests here ended up. */
    outcome: CountBar[];
    outcomeLabel: string | null;
    /** Reports: most common categories here. Projects: projects here by category. Development: homes by type. */
    breakdown: CountBar[];
    breakdownLabel: string | null;
    /** Development: the largest sites here by net homes. */
    comparison: CountBar[];
    comparisonLabel: string | null;
  };
  related: RelatedRecord[];
  relatedLabel: string | null;
}

export interface RecordRow {
  id: string;
  source_id: string;
  title: string;
  url: string;
  published_at: Date | string | null;
  text: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);
const monthKey = (value: Date | string) => new Date(value).toISOString().slice(0, 7);

/** The last `count` months as YYYY-MM, oldest first. */
export function lastMonths(now: number, count = 12): string[] {
  const d = new Date(now);
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    months.push(m.toISOString().slice(0, 7));
  }
  return months;
}

/** Every "lat, lng" in lines like "- Coordinates: 37.5, -121.9" or "- Map location (approximate): …". */
export function recordPoints(text: string, label: string): RecordPoint[] {
  const points: RecordPoint[] = [];
  for (const m of text.matchAll(/^- (?:Coordinates|Map location \(approximate\)): (-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/gm)) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) points.push({ lat, lng, label });
  }
  return points;
}

const HIDDEN_FACTS = new Set(["Coordinates", "Map location (approximate)", "Neighborhood", "Project page", "Program page", "Description", "CIP description"]);

/** Labeled "- Label: value" lines before the first sub-heading, minus ones shown elsewhere in the popup. */
export function recordFacts(text: string): RecordFact[] {
  const head = text.split(/\n## /)[0];
  const facts: RecordFact[] = [];
  for (const m of head.matchAll(/^- ([^:\n]{1,60}): (.+)$/gm)) {
    const label = m[1].trim().replace(/^Status as of .+$/, "Status");
    const value = m[2].trim();
    if (HIDDEN_FACTS.has(m[1].trim()) || !value || value === "0") continue;
    if (/^https?:\/\//i.test(value)) continue;
    facts.push({ label, value });
  }
  return facts;
}

/** Street segments of a grouped street program ("## Adams Ave" blocks). */
export function streetSegments(text: string): StreetSegment[] {
  return text
    .split(/\n## /)
    .slice(1)
    .map((block) => ({
      road: field(block, "Road") ?? block.split("\n")[0].trim(),
      from: field(block, "From"),
      to: field(block, "To"),
      work: field(block, "Work type"),
    }))
    .filter((s) => s.road);
}

export const neighborhoodOf = (row: { title: string; text: string }) =>
  field(row.text, "Neighborhood") ?? row.title.match(/\s+–\s+([^–]+)$/)?.[1]?.trim() ?? null;

const numberFact = (text: string, label: string) => {
  const value = Number((field(text, label) ?? "").replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
};

const PROJECT_LABEL: Record<ProjectKind, string> = {
  capital: "Capital projects",
  street: "Street maintenance",
  transportation: "Transportation",
  development: "Development sites",
};

/** Builds the popup from the record's full text and its neighborhood's (or agency's) other records. */
export function buildRecordDetail(record: RecordRow, others: RecordRow[], now = Date.now()): RecordDetail {
  const kind = RECORD_SOURCES[record.source_id as keyof typeof RECORD_SOURCES] ?? "report";
  const text = record.text;
  const neighborhood = kind === "alert" ? null : neighborhoodOf(record);
  const activityRow: ActivityRow = { ...record };
  const months = lastMonths(now);
  const detail: RecordDetail = {
    id: record.id,
    kind,
    projectKind: null,
    sourceId: record.source_id,
    title: record.title,
    url: record.url,
    publishedAt: iso(record.published_at),
    neighborhood,
    status: null,
    open: null,
    body: null,
    facts: recordFacts(text),
    points: [],
    segments: [],
    links: [],
    charts: { monthly: [], monthlyLabel: null, outcome: [], outcomeLabel: null, breakdown: [], breakdownLabel: null, comparison: [], comparisonLabel: null },
    related: [],
    relatedLabel: null,
  };

  if (kind === "report") {
    const report = toReport(activityRow);
    const category = report.category;
    detail.title = category;
    detail.status = report.status;
    detail.open = report.open;
    detail.body = section(text, "Description");
    detail.points = recordPoints(text, category);
    detail.links = [{ label: `${report.caseNumber ?? "This request"} on the Fremont App`, url: record.url }];

    const residents = others.filter((o) => o.source_id === record.source_id && !isStaffEntry(o.text));
    const sameCategory = residents.filter((o) => requestCategory(o.title) === category);
    const byMonth = new Map(months.map((m) => [m, { value: 0, highlight: 0 }]));
    for (const o of residents) {
      if (!o.published_at) continue;
      const bucket = byMonth.get(monthKey(o.published_at));
      if (!bucket) continue;
      bucket.value++;
      if (requestCategory(o.title) === category) bucket.highlight++;
    }
    detail.charts.monthly = months.map((month) => ({ month, ...byMonth.get(month)! }));
    detail.charts.monthlyLabel = `Fremont App requests from ${neighborhood ?? "this area"} per month, with “${category}” highlighted`;

    const outcomes = new Map<string, number>();
    for (const o of sameCategory) {
      const status = toReport(o).status ?? "Unknown";
      const key = /^(closed|cancel)/i.test(status) ? (status.match(/\(([^)]+)\)/)?.[1] ? `Closed: ${clip(status.match(/\(([^)]+)\)/)![1], 40)}` : "Closed") : status.replace(/\s*\(.*$/, "");
      outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
    }
    detail.charts.outcome = [...outcomes].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6);
    // A city staff entry has no residents' requests of its category to compare with.
    detail.charts.outcomeLabel = sameCategory.length
      ? `Where the ${sameCategory.length} “${category}” ${sameCategory.length === 1 ? "request" : "requests"} from ${neighborhood ?? "here"} stand`
      : null;

    const yearAgo = now - 365 * DAY_MS;
    const categories = new Map<string, number>();
    for (const o of residents) {
      if (o.published_at && new Date(o.published_at).getTime() < yearAgo) continue;
      const c = requestCategory(o.title);
      categories.set(c, (categories.get(c) ?? 0) + 1);
    }
    detail.charts.breakdown = [...categories].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6);
    detail.charts.breakdownLabel = `Most-reported problems in ${neighborhood ?? "this area"}, past year`;

    const here = detail.points[0];
    if (here) {
      detail.related = residents
        // Nearby problems from the past year; older ones say little about the block today.
        .filter((o) => o.id !== record.id && (!o.published_at || new Date(o.published_at).getTime() >= yearAgo))
        .map((o) => ({ o, point: recordPoints(o.text, "")[0] }))
        .filter(({ point }) => point && haversineKm([here.lng, here.lat], [point.lng, point.lat]) <= 0.8)
        .sort((a, b) => new Date(b.o.published_at ?? 0).getTime() - new Date(a.o.published_at ?? 0).getTime())
        .slice(0, 5)
        .map(({ o }) => {
          const r = toReport(o);
          return { id: o.id, title: r.category, subtitle: [r.address, r.status].filter(Boolean).join(" · ") || null, publishedAt: r.reportedAt };
        });
      detail.relatedLabel = "Other requests within half a mile";
    }
  } else if (kind === "alert") {
    const alert = toAlert(activityRow);
    detail.body = section(text, "Full notification");
    detail.links = [{ label: `Full notice on Nixle`, url: record.url }];
    const agencyAlerts = others.filter((o) => o.source_id === record.source_id);
    const byMonth = new Map(months.map((m) => [m, 0]));
    for (const o of agencyAlerts) if (o.published_at && byMonth.has(monthKey(o.published_at))) byMonth.set(monthKey(o.published_at), byMonth.get(monthKey(o.published_at))! + 1);
    detail.charts.monthly = months.map((month) => ({ month, value: byMonth.get(month)! }));
    detail.charts.monthlyLabel = `${alert.agency ?? "Agency"} notices per month`;
    const topics = new Map<string, number>();
    for (const o of agencyAlerts) {
      const topic = alertTopic(o.title);
      topics.set(topic, (topics.get(topic) ?? 0) + 1);
    }
    detail.charts.breakdown = [...topics].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6);
    detail.charts.breakdownLabel = `What ${alert.agency ?? "the agency"} posts about`;
    detail.related = agencyAlerts
      .filter((o) => o.id !== record.id)
      .sort((a, b) => new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime())
      .slice(0, 5)
      .map((o) => ({ id: o.id, title: o.title, subtitle: field(o.text, "Agency"), publishedAt: iso(o.published_at) }));
    detail.relatedLabel = `Recent notices from ${alert.agency ?? "the same agency"}`;
  } else {
    const project = toProject(activityRow);
    detail.projectKind = project.kind;
    detail.title = project.title;
    detail.status = project.status;
    detail.body = field(text, "Description") ?? field(text, "CIP description");
    detail.points = recordPoints(text, project.title);
    detail.segments = streetSegments(text);
    const page = field(text, "Project page") ?? field(text, "Program page");
    if (page && /^https?:\/\//i.test(page)) detail.links.push({ label: "City project page", url: page });

    const nearby = others.filter((o) => o.id !== record.id);
    if (project.kind === "development") {
      const units: [string, string][] = [
        ["New single-family units", "Single-family"],
        ["New townhouse units", "Townhouses"],
        ["New condominium units", "Condominiums"],
      ];
      detail.charts.breakdown = units.map(([labelInText, label]) => ({ label, value: numberFact(text, labelInText) })).filter((b) => b.value > 0);
      detail.charts.breakdownLabel = "New homes by type";
      const sites = [record, ...nearby.filter((o) => o.source_id === record.source_id)]
        .map((o) => ({ label: withoutNeighborhood(o.title), value: numberFact(o.text, "Net residential units"), id: o.id }))
        .filter((s) => s.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 8);
      detail.charts.comparison = sites.map(({ label, value }) => ({ label, value }));
      detail.charts.comparisonLabel = `Largest development sites in ${neighborhood ?? "this area"} by net new homes`;
    } else {
      const kinds = new Map<string, number>();
      for (const o of [record, ...nearby]) {
        if (!(o.source_id in RECORD_SOURCES) || RECORD_SOURCES[o.source_id as keyof typeof RECORD_SOURCES] === "report") continue;
        const p = toProject(o);
        const label = p.kind === "development" ? PROJECT_LABEL.development : (field(o.text, "CIP category") ?? PROJECT_LABEL[p.kind]);
        kinds.set(label, (kinds.get(label) ?? 0) + 1);
      }
      detail.charts.breakdown = [...kinds].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 7);
      detail.charts.breakdownLabel = `City projects and sites in ${neighborhood ?? "this area"} by category`;
    }
    const projectNumber = field(text, "Project number");
    detail.related = nearby
      .filter((o) => o.source_id !== "fremont-app-requests-api")
      .map((o) => ({ o, p: toProject(o) }))
      .filter(({ o, p }) => (projectNumber && field(o.text, "Project number") === projectNumber) || p.kind === project.kind)
      .filter(({ p }, i, all) => all.findIndex((x) => x.p.title === p.title) === i && p.title !== project.title)
      .slice(0, 5)
      .map(({ o, p }) => ({ id: o.id, title: p.title, subtitle: p.location, publishedAt: null }));
    detail.relatedLabel = project.kind === "development" ? `Other development sites in ${neighborhood ?? "this area"}` : `More ${PROJECT_LABEL[project.kind].toLowerCase()} in ${neighborhood ?? "this area"}`;
  }
  return detail;
}

/** A rough topic for a police or city notice, from its headline. */
export function alertTopic(title: string): string {
  if (/collision|crash|traffic|road closure|closure|detour/i.test(title)) return "Traffic and roads";
  if (/arrest|suspect|robbery|burglar|shooting|homicide|theft|stolen|assault|scam|fraud|missing/i.test(title)) return "Crime and safety";
  if (/week in review|recap/i.test(title)) return "Week in review";
  if (/event|festival|parade|celebrat|community|meeting|workshop|welcome/i.test(title)) return "Community and events";
  if (/fire|smoke|evacuat|power|outage|weather|heat|storm|flood|earthquake/i.test(title)) return "Emergencies and weather";
  return "Other notices";
}

/** The record and the rows its charts compare against, or null when it isn't a neighborhood record. */
export async function getRecordDetail(id: string, now = Date.now()): Promise<RecordDetail | null> {
  if (!UUID.test(id)) return null;
  const sources = Object.keys(RECORD_SOURCES).map((s) => `'${s}'`).join(", ");
  const { rows } = await db().query<RecordRow & { ordinal: number }>(
    `SELECT d.id, d.source_id, d.title, d.url, d.published_at, c.text, c.ordinal
       FROM agent_documents d JOIN agent_chunks c ON c.document_id = d.id
      WHERE d.id = $1 AND d.source_id IN (${sources})
      ORDER BY c.ordinal`,
    [id],
  );
  if (!rows.length) return null;
  const record: RecordRow = { ...rows[0], text: rows.map((r) => r.text).join("\n") };
  const kind = RECORD_SOURCES[record.source_id as keyof typeof RECORD_SOURCES];
  const neighborhood = neighborhoodOf(record);

  let others: RecordRow[] = [];
  if (kind === "alert") {
    ({ rows: others } = await db().query<RecordRow>(
      `SELECT d.id, d.source_id, d.title, d.url, d.published_at, c.text
         FROM agent_documents d JOIN agent_chunks c ON c.document_id = d.id AND c.ordinal = 0
        WHERE d.source_id = $1`,
      [record.source_id],
    ));
  } else if (neighborhood) {
    const scope = kind === "report" ? `d.source_id = 'fremont-app-requests-api'` : `d.source_id IN (${sources}) AND d.source_id NOT IN ('fremont-app-requests-api', 'fremont-police-nixle', 'city-of-fremont-nixle')`;
    ({ rows: others } = await db().query<RecordRow>(
      `SELECT d.id, d.source_id, d.title, d.url, d.published_at, c.text
         FROM agent_documents d JOIN agent_chunks c ON c.document_id = d.id AND c.ordinal = 0
        WHERE ${scope} AND d.title LIKE $1`,
      [`% – ${neighborhood}`],
    ));
  }
  return buildRecordDetail(record, others, now);
}

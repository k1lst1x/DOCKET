import { db } from "./db";

// What the reading agent has on file for each neighborhood, for group pages and the groups directory:
// Fremont App service requests residents filed, city capital, street and transportation projects,
// development sites, and the latest police and city alerts. The agent stores each record as a document
// whose title ends in " – <neighborhood>" and whose first chunk holds "- Label: value" lines, so one query
// per page reads everything and the parsing below stays pure (and tested).

const REQUESTS = "fremont-app-requests-api";
const PROJECT_SOURCES = ["fremont-capital-projects-gis", "fremont-annual-street-programs-gis", "fremont-transportation-projects-gis"] as const;
const DEVELOPMENT = "fremont-development-activity-gis";
const ALERT_SOURCES = ["fremont-police-nixle", "city-of-fremont-nixle"] as const;
const TAGGED_SOURCES = [REQUESTS, ...PROJECT_SOURCES, DEVELOPMENT];

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 30;
const MAX_REPORTS = 8;
const MAX_PROJECTS = 9;
const MAX_DEVELOPMENT = 6;

const hasDatabase = () => Boolean(process.env.DSQL_ENDPOINT?.trim());
const inList = (values: readonly string[]) => values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");

export interface ResidentReport {
  id: string;
  caseNumber: string | null;
  category: string;
  status: string | null;
  open: boolean;
  address: string | null;
  reportedAt: string | null;
  description: string | null;
  url: string;
}

export type ProjectKind = "capital" | "street" | "transportation" | "development";

export interface CityProject {
  id: string;
  kind: ProjectKind;
  title: string;
  description: string | null;
  status: string | null;
  location: string | null;
  /** Project numbers, units and other short facts, already labeled. */
  facts: string[];
  url: string | null;
}

export interface SafetyAlert {
  id: string;
  title: string;
  agency: string | null;
  postedAt: string | null;
  excerpt: string | null;
  url: string;
}

export interface NeighborhoodActivity {
  reports: ResidentReport[];
  reportsLast30Days: number;
  reportsTotal: number;
  openReports: number;
  projects: CityProject[];
  projectsTotal: number;
  development: CityProject[];
  developmentTotal: number;
  alerts: SafetyAlert[];
}

export interface ActivityRow {
  id: string;
  source_id: string;
  title: string;
  url: string;
  published_at: Date | string | null;
  text: string;
}

/** The value of a "- Label: value" line. */
export function field(text: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = text.match(new RegExp(`^- ${escaped}: (.+)$`, "m"))?.[1]?.trim();
  return value || null;
}

/** The text under a "## Heading", up to the next heading. */
export function section(text: string, heading: string): string | null {
  const start = text.indexOf(`## ${heading}\n`);
  if (start < 0) return null;
  const body = text.slice(start + heading.length + 4).split(/\n## /)[0].replace(/\s+/g, " ").trim();
  return body || null;
}

export function clip(text: string | null, max: number): string | null {
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}

const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);

/** City staff log their own cleanups in the Fremont App ("STAFF ENTRY, …"); those aren't residents' requests. */
export const isStaffEntry = (text: string) => /^STAFF\b/i.test(section(text, "Description") ?? "");

/** "Fremont App request CAS-29532-C7H5J2: Encampment - Tent – Niles" → its category. */
export function requestCategory(title: string): string {
  return title.match(/^Fremont App request [^:]+:\s*(.+?)(?:\s+–\s+[^–]+)?$/)?.[1]?.trim() || "Service request";
}

export function toReport(row: ActivityRow): ResidentReport {
  const statusLine = row.text.match(/^- Status as of [^:]+: (.+)$/m)?.[1]?.trim() ?? null;
  return {
    id: row.id,
    caseNumber: field(row.text, "Case number"),
    category: field(row.text, "Category") ?? requestCategory(row.title),
    status: statusLine,
    open: statusLine ? !/^(closed|cancel)/i.test(statusLine) : false,
    address: field(row.text, "Address"),
    reportedAt: iso(row.published_at),
    description: clip(section(row.text, "Description"), 220),
    url: row.url,
  };
}

const PROJECT_KIND: Record<string, ProjectKind> = {
  "fremont-capital-projects-gis": "capital",
  "fremont-annual-street-programs-gis": "street",
  "fremont-transportation-projects-gis": "transportation",
  [DEVELOPMENT]: "development",
};

/** Strip the " – <neighborhood>" suffix the agent adds to record titles. */
export const withoutNeighborhood = (title: string) => title.replace(/\s+–\s+[^–]+$/, "").trim();

const link = (value: string | null) => (value && /^https?:\/\//i.test(value) ? value : null);

export function toProject(row: ActivityRow): CityProject {
  const kind = PROJECT_KIND[row.source_id] ?? "capital";
  const t = row.text;
  const facts: string[] = [];
  const add = (label: string, value: string | null) => {
    if (value && value !== "0") facts.push(`${label}: ${value}`);
  };
  let location: string | null = null;
  if (kind === "development") {
    location = [field(t, "Street number"), field(t, "Street")].filter(Boolean).join(" ") || null;
    add("Project", field(t, "Project number"));
    add("Net homes", field(t, "Net residential units"));
  } else if (kind === "street") {
    const places = field(t, "Mapped locations");
    location = places ? `${places} street ${Number(places) === 1 ? "segment" : "segments"}` : null;
  } else {
    const road = field(t, "Road");
    const from = field(t, "From");
    const to = field(t, "To");
    location = road ? [road, from && to ? `from ${from} to ${to}` : from ? `at ${from}` : null].filter(Boolean).join(" ") : null;
    add("Project", field(t, "Project number"));
    add("Category", field(t, "CIP category"));
  }
  return {
    id: row.id,
    kind,
    title: withoutNeighborhood(row.title),
    description: clip(field(t, "Description") ?? field(t, "CIP description"), 260),
    status: field(t, "Status") ?? field(t, "Notes"),
    location,
    facts,
    url: link(field(t, "Project page") ?? field(t, "Program page")),
  };
}

export function toAlert(row: ActivityRow): SafetyAlert {
  return {
    id: row.id,
    title: row.title,
    agency: field(row.text, "Agency"),
    postedAt: iso(row.published_at),
    excerpt: clip(section(row.text, "Full notification"), 200),
    url: row.url,
  };
}

const publishedMs = (row: ActivityRow) => (row.published_at ? new Date(row.published_at).getTime() : 0);

/** Group one neighborhood's rows into the page's sections. */
export function summarizeActivity(rows: ActivityRow[], now = Date.now()): NeighborhoodActivity {
  const requests = rows.filter((r) => r.source_id === REQUESTS && !isStaffEntry(r.text)).sort((a, b) => publishedMs(b) - publishedMs(a));
  const reports = requests.map(toReport);
  const projectRows = rows.filter((r) => (PROJECT_SOURCES as readonly string[]).includes(r.source_id));
  // Named projects first, then street programs; within each, alphabetical so the page is stable.
  const order: Record<ProjectKind, number> = { capital: 0, transportation: 0, street: 1, development: 2 };
  const projects = projectRows.map(toProject).sort((a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title));
  // The same project often has several mapped points in one neighborhood; list it once.
  const uniqueProjects = projects.filter((p, i) => projects.findIndex((q) => q.title === p.title && q.kind === p.kind) === i);
  const development = rows
    .filter((r) => r.source_id === DEVELOPMENT)
    .map(toProject)
    .sort((a, b) => a.title.localeCompare(b.title));
  const alerts = rows
    .filter((r) => (ALERT_SOURCES as readonly string[]).includes(r.source_id))
    .sort((a, b) => publishedMs(b) - publishedMs(a))
    .map(toAlert);
  return {
    reports: reports.slice(0, MAX_REPORTS),
    reportsLast30Days: requests.filter((r) => now - publishedMs(r) <= RECENT_DAYS * DAY_MS).length,
    reportsTotal: reports.length,
    openReports: reports.filter((r) => r.open).length,
    projects: uniqueProjects.slice(0, MAX_PROJECTS),
    projectsTotal: uniqueProjects.length,
    development: development.slice(0, MAX_DEVELOPMENT),
    developmentTotal: development.length,
    alerts: alerts.slice(0, 4),
  };
}

/** One query: every record tagged with this neighborhood, plus the four newest police and city alerts. */
export async function getNeighborhoodActivity(neighborhoodName: string, now = Date.now()): Promise<NeighborhoodActivity | null> {
  if (!hasDatabase()) return null;
  try {
    const { rows } = await db().query<ActivityRow>(
      `SELECT d.id, d.source_id, d.title, d.url, d.published_at, c.text
         FROM agent_documents d JOIN agent_chunks c ON c.document_id = d.id AND c.ordinal = 0
        WHERE d.source_id IN (${inList(TAGGED_SOURCES)}) AND d.title LIKE $1
       UNION ALL
       (SELECT d.id, d.source_id, d.title, d.url, d.published_at, c.text
          FROM agent_documents d JOIN agent_chunks c ON c.document_id = d.id AND c.ordinal = 0
         WHERE d.source_id IN (${inList(ALERT_SOURCES)})
         ORDER BY d.published_at DESC NULLS LAST
         LIMIT 4)`,
      [`% – ${neighborhoodName}`],
    );
    return summarizeActivity(rows, now);
  } catch (error) {
    console.error("[docket] neighborhood activity unavailable", error);
    return null;
  }
}

export interface ActivityCounts {
  reportsLast30Days: number;
  reportsTotal: number;
  projects: number;
  development: number;
  latestReport: { category: string; reportedAt: string } | null;
}

export interface CountRow {
  source_id: string;
  title: string;
  published_at: Date | string | null;
  staff: boolean;
}

/** Per-neighborhood counts for the directory, keyed by neighborhood name. */
export function countActivity(rows: CountRow[], now = Date.now()): Map<string, ActivityCounts> {
  const byName = new Map<string, ActivityCounts & { projectTitles: Set<string> }>();
  for (const row of rows) {
    const name = row.title.match(/\s+–\s+([^–]+)$/)?.[1]?.trim();
    if (!name) continue;
    let entry = byName.get(name);
    if (!entry) {
      entry = { reportsLast30Days: 0, reportsTotal: 0, projects: 0, development: 0, latestReport: null, projectTitles: new Set() };
      byName.set(name, entry);
    }
    if (row.source_id === REQUESTS) {
      if (row.staff) continue;
      entry.reportsTotal++;
      const at = row.published_at ? new Date(row.published_at) : null;
      if (at && now - at.getTime() <= RECENT_DAYS * DAY_MS) entry.reportsLast30Days++;
      if (at && (!entry.latestReport || at.toISOString() > entry.latestReport.reportedAt)) {
        entry.latestReport = { category: requestCategory(row.title), reportedAt: at.toISOString() };
      }
    } else if (row.source_id === DEVELOPMENT) {
      entry.development++;
    } else {
      entry.projectTitles.add(`${row.source_id}:${withoutNeighborhood(row.title)}`);
      entry.projects = entry.projectTitles.size;
    }
  }
  return new Map(
    [...byName].map(([name, entry]) => [
      name,
      { reportsLast30Days: entry.reportsLast30Days, reportsTotal: entry.reportsTotal, projects: entry.projects, development: entry.development, latestReport: entry.latestReport },
    ]),
  );
}

/** Directory counts for every neighborhood in one query. Null without a database or on error. */
export async function getActivityCounts(now = Date.now()): Promise<Map<string, ActivityCounts> | null> {
  if (!hasDatabase()) return null;
  try {
    const { rows } = await db().query<CountRow>(
      `SELECT d.source_id, d.title, d.published_at,
              (d.source_id = '${REQUESTS}' AND position('## Description' || chr(10) || 'STAFF' in c.text) > 0) AS staff
         FROM agent_documents d JOIN agent_chunks c ON c.document_id = d.id AND c.ordinal = 0
        WHERE d.source_id IN (${inList(TAGGED_SOURCES)}) AND d.title LIKE '% – %'`,
    );
    return countActivity(rows, now);
  } catch (error) {
    console.error("[docket] neighborhood activity counts unavailable", error);
    return null;
  }
}

import districtData from "@/data/fremont-districts.json";
import { DOCUMENTS, GROUP_SEEDS, ITEMS, OUTCOMES } from "@/data/fixtures";
import { distanceToPolygonKm, pointInPolygon } from "./geo";
import { geocode } from "./geocode";
import { sampleIssueId } from "./issue-ids";
import type {
  FindResult,
  Group,
  GroupDetail,
  GroupSummary,
  ItemStatus,
  LngLat,
  NearbyGroup,
  WatchItem,
  WeeklyStats,
} from "./types";

// Data access for the public side. Backed by sample fixtures today; swap these
// functions for database queries without touching pages or route handlers.

const DAY_MS = 24 * 60 * 60 * 1000;
const NEARBY_KM = 2;
const PUBLIC_STATUSES = new Set<ItemStatus>(["watching", "approved"]);

const boundaries = new Map(districtData.districts.map((d) => [d.name, d.polygon as unknown as LngLat[]]));

const GROUPS: Group[] = GROUP_SEEDS.map((seed) => {
  const boundary = boundaries.get(seed.district);
  if (!boundary) throw new Error(`No boundary for district ${seed.district}`);
  return { ...seed, boundary };
});

/** Items the public can see: surfaced to the group and still open. */
function currentItems(slug: string, now: number): WatchItem[] {
  return ITEMS.filter((i) => i.groupSlug === slug && PUBLIC_STATUSES.has(i.status) && Date.parse(i.deadline) > now)
    .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline))
    .map((i) => ({ ...i, issueId: sampleIssueId(i.ref) }));
}

function summarize(group: Group, now: number): GroupSummary {
  const urgent = currentItems(group.slug, now)[0];
  return {
    slug: group.slug,
    name: group.name,
    district: group.district,
    description: group.description,
    memberCount: group.memberCount,
    lastActivityAt: group.lastActivityAt,
    urgentItem: urgent
      ? { ref: urgent.ref, title: urgent.title, deadline: urgent.deadline, deadlineKind: urgent.deadlineKind }
      : null,
  };
}

function detail(group: Group, now: number): GroupDetail {
  return {
    ...group,
    items: currentItems(group.slug, now),
    outcomes: OUTCOMES.filter((o) => o.groupSlug === group.slug).sort(
      (a, b) => Date.parse(b.decidedOn) - Date.parse(a.decidedOn),
    ),
  };
}

/** Most recently active first. */
export function listGroups(now = Date.now()): GroupSummary[] {
  return [...GROUPS]
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))
    .map((g) => summarize(g, now));
}

export function getGroup(slug: string, now = Date.now()): GroupDetail | null {
  const group = GROUPS.find((g) => g.slug === slug);
  return group ? detail(group, now) : null;
}

export async function findGroups(rawQuery: string, now = Date.now()): Promise<FindResult> {
  const query = rawQuery.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!query) return { status: "unresolved", query, reason: "empty" };

  const geo = await geocode(query);
  if (!geo.ok) return { status: "unresolved", query, reason: geo.reason };

  const point: LngLat = [geo.point.lng, geo.point.lat];
  const containing = GROUPS.find((g) => pointInPolygon(point, g.boundary));
  const nearby: NearbyGroup[] = GROUPS.filter((g) => g !== containing)
    .map((g) => ({ group: g, km: distanceToPolygonKm(point, g.boundary) }))
    .filter(({ km }) => km <= NEARBY_KM)
    .sort((a, b) => a.km - b.km)
    .map(({ group, km }) => ({ ...summarize(group, now), distanceKm: Math.round(km * 100) / 100, boundary: group.boundary }));

  if (containing) return { status: "match", query, point: geo.point, match: detail(containing, now), nearby };
  if (nearby.length) return { status: "nearby", query, point: geo.point, nearby };
  return { status: "none", query, point: geo.point };
}

/**
 * The seven days ending at the agent's latest activity (a document read or an
 * item surfaced). Counts come straight from those records, never a hand-set number.
 */
export function getWeeklyStats(now = Date.now()): WeeklyStats | null {
  if (DOCUMENTS.length === 0) return null;
  const end = Math.max(...DOCUMENTS.map((d) => Date.parse(d.readAt)), ...ITEMS.map((i) => Date.parse(i.surfacedAt)));
  const start = end - 7 * DAY_MS;
  const inWindow = (iso: string) => {
    const t = Date.parse(iso);
    return t > start && t <= end;
  };

  const documents = DOCUMENTS.filter((d) => inWindow(d.readAt));
  const surfaced = ITEMS.filter((i) => PUBLIC_STATUSES.has(i.status) && inWindow(i.surfacedAt));

  return {
    pagesRead: documents.reduce((sum, d) => sum + d.pageCount, 0),
    documentsRead: documents.length,
    itemsSurfaced: surfaced.length,
    neighborhoods: new Set(surfaced.map((i) => i.groupSlug)).size,
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(end).toISOString(),
    isCurrentWeek: now - end <= 7 * DAY_MS,
    source: "sample",
  };
}

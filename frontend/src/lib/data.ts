import neighborhoodData from "@/data/fremont-neighborhoods.json";
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

// Data access for the public side, safe for the browser (the static preview runs findGroups there).
// Groups: one per official Fremont neighborhood (the City's 32 neighborhood areas), with that
// neighborhood's slug, name and real boundary. Real items, outcomes and member counts come from the
// database through lib/live-data.ts; the saved sample items here only fill the static preview.
// The first prototype's five sample groups (e.g. "niles-neighbors") map onto their neighborhoods, so old
// links, old sessions and the saved sample items still land in the right place.

const DAY_MS = 24 * 60 * 60 * 1000;
const NEARBY_KM = 2;
const MAX_NEARBY = 3;
const PUBLIC_STATUSES = new Set<ItemStatus>(["watching", "approved"]);
const FOUNDED_ON = "2026-09-13";

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Sample group slugs from before the neighborhood groups, mapped to the neighborhood group that replaced them. */
export const LEGACY_GROUP_SLUGS: Record<string, string> = Object.fromEntries(
  GROUP_SEEDS.filter((g) => g.slug !== slugOf(g.district)).map((g) => [g.slug, slugOf(g.district)]),
);

/** Today's group slug for any slug, old or new. */
export const currentGroupSlug = (slug: string) => LEGACY_GROUP_SLUGS[slug] ?? slug;

export const DEFAULT_WATCHLIST = ["Housing and development", "Traffic and street safety", "Parks and trails", "Public safety", "Schools", "Local business"];

const GROUPS: Group[] = (neighborhoodData as { slug: string; name: string; polygon: unknown }[]).map((n) => {
  const seed = GROUP_SEEDS.find((g) => slugOf(g.district) === n.slug);
  return {
    id: `grp_${n.slug.replace(/-/g, "_")}`,
    slug: n.slug,
    neighborhoodSlug: n.slug,
    name: n.name,
    district: n.name,
    description:
      seed?.description ??
      `Neighbors in ${n.name}, one of Fremont's 32 official neighborhoods. See what city hall is deciding for these streets and weigh in before the deadline.`,
    boundary: n.polygon as LngLat[],
    memberCount: 0,
    watchlist: seed?.watchlist ?? DEFAULT_WATCHLIST,
    foundedOn: FOUNDED_ON,
    lastActivityAt: seed?.lastActivityAt ?? `${FOUNDED_ON}T00:00:00-07:00`,
    meets: null,
  };
});

/** Saved sample items the static preview shows for a group. */
function currentItems(slug: string, now: number): WatchItem[] {
  return ITEMS.filter((i) => currentGroupSlug(i.groupSlug) === slug && PUBLIC_STATUSES.has(i.status) && Date.parse(i.deadline) > now)
    .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline))
    .map((i) => ({ ...i, groupSlug: slug, issueId: sampleIssueId(i.ref) }));
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
    citywideItems: [],
    outcomes: OUTCOMES.filter((o) => currentGroupSlug(o.groupSlug) === group.slug).sort(
      (a, b) => Date.parse(b.decidedOn) - Date.parse(a.decidedOn),
    ),
  };
}

/** Most recently active first, then by name. */
export function listGroups(now = Date.now()): GroupSummary[] {
  return [...GROUPS]
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt) || a.name.localeCompare(b.name))
    .map((g) => summarize(g, now));
}

/** A group by its slug; old sample group slugs resolve to their neighborhood group. */
export function getGroup(slug: string, now = Date.now()): GroupDetail | null {
  const current = currentGroupSlug(slug);
  const group = GROUPS.find((g) => g.slug === current);
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
    .slice(0, MAX_NEARBY)
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
    neighborhoods: new Set(surfaced.map((i) => currentGroupSlug(i.groupSlug))).size,
    windowStart: new Date(start).toISOString(),
    windowEnd: new Date(end).toISOString(),
    isCurrentWeek: now - end <= 7 * DAY_MS,
    source: "sample",
  };
}

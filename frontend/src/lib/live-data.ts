import { db } from "./db";
import { getGroup, getWeeklyStats, listGroups } from "./data";
import type { GroupDetail, GroupSummary, ItemStatus, Outcome, WatchItem, WeeklyStats } from "./types";

// Real Docket data for group pages, the groups list and the home page, from Aurora DSQL: agenda items the
// agent surfaced (issues), decisions recorded in meeting minutes (agent_meeting_outcomes, written by the
// backend) and what the agent read this week (agent_documents). Sample rows never appear here.
// Every group is a Fremont neighborhood. An item belongs to a group when it names the group or its
// neighborhood; an item that names neither (group_slug NULL, no neighborhoods) is citywide and shows on
// every group page. Without a database (the static GitHub Pages preview, CI builds) pages keep the saved
// sample content instead.

export const hasDatabase = () => Boolean(process.env.DSQL_ENDPOINT?.trim());

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (value: Date | string | number | null | undefined) => (value === null || value === undefined ? null : new Date(value).toISOString());

export interface IssueItemRow {
  id: string;
  ref: string;
  title: string;
  body: string;
  meeting_at: Date | string | null;
  deadline: Date | string | null;
  deadline_kind: string | null;
  topic: string | null;
  status: ItemStatus;
  citation: string | null;
  surfaced_at: Date | string;
  summary: string | null;
}

/** The first sentence of a summary, for a card. */
export function firstSentence(text: string | null, max = 220): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  const sentence = clean.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? clean;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

/** An issue row as a group-page card. Items with neither a deadline nor a meeting time can't be placed, so they're skipped. */
export function toWatchItem(row: IssueItemRow, groupSlug: string): WatchItem | null {
  const deadline = iso(row.deadline ?? row.meeting_at);
  const meetingAt = iso(row.meeting_at ?? row.deadline);
  if (!deadline || !meetingAt) return null;
  return {
    id: row.id,
    issueId: row.id,
    ref: row.ref,
    groupSlug,
    title: row.title,
    body: row.body,
    meetingAt,
    deadline,
    deadlineKind: row.deadline_kind?.trim() || (row.deadline ? "Deadline" : "Meeting"),
    brief: firstSentence(row.summary),
    topic: row.topic?.trim() || "City hall",
    status: row.status,
    score: 0,
    scoreReason: "",
    citation: row.citation ?? "",
    documentId: "",
    surfacedAt: iso(row.surfaced_at) ?? meetingAt,
  };
}

/** Where an item belongs: to this group (by group or neighborhood), to all of Fremont, or elsewhere. */
export function itemScope(row: { group_slug: string | null; neighborhood_slugs: unknown }, group: { slug: string; neighborhoodSlug: string }): "group" | "citywide" | null {
  const neighborhoods = Array.isArray(row.neighborhood_slugs) ? row.neighborhood_slugs : [];
  if (row.group_slug === group.slug || neighborhoods.includes(group.neighborhoodSlug)) return "group";
  if (!row.group_slug && neighborhoods.length === 0) return "citywide";
  return null;
}

export interface OutcomeDbRow {
  id: string;
  body: string;
  /** YYYY-MM-DD */
  meeting_date: string;
  item_label: string;
  title: string;
  result: string;
  action_text: string;
  vote: { ayes?: unknown; noes?: unknown; abstain?: unknown; absent?: unknown } | null;
  source_url: string | null;
}

const MEETING_BODIES: Record<string, string> = {
  city_council: "City Council",
  planning_commission: "Planning Commission",
  zoning_administrator: "Zoning Administrator",
  school_board: "FUSD Board of Education",
};

const RESULTS: Record<string, Outcome["result"]> = {
  approved: "Approved",
  denied: "Denied",
  continued: "Continued",
  referred: "Referred",
  received: "Received and filed",
  no_action: "No action",
};

const count = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);

/** A decision from meeting minutes as a group-page row. Unknown results are skipped rather than guessed. */
export function toOutcome(row: OutcomeDbRow): Outcome | null {
  const result = RESULTS[row.result];
  if (!result || !/^\d{4}-\d{2}-\d{2}$/.test(row.meeting_date)) return null;
  const body = MEETING_BODIES[row.body] ?? "Meeting";
  return {
    id: row.id,
    ref: `${body} · ${row.item_label}`,
    title: row.title,
    body: row.action_text,
    decidedOn: row.meeting_date,
    result,
    vote: row.vote ? { yes: count(row.vote.ayes), no: count(row.vote.noes), abstain: count(row.vote.abstain), absent: count(row.vote.absent) } : null,
    groupPosition: "No position",
    note: "",
    sourceUrl: row.source_url && /^https?:\/\//i.test(row.source_url) ? row.source_url : null,
  };
}

const errorCode = (error: unknown) => (error as { code?: string } | null)?.code;

type ScopedIssueRow = IssueItemRow & { group_slug: string | null; neighborhood_slugs: unknown };

const OPEN_REAL_ISSUES = `SELECT i.id, i.ref, i.title, i.body, i.meeting_at, i.deadline, i.deadline_kind, i.topic, i.status, i.citation,
         i.surfaced_at, i.group_slug, i.neighborhood_slugs, a.summary
  FROM issues i LEFT JOIN issue_analyses a ON a.issue_id = i.id
  WHERE i.is_sample = false AND i.status IN ('watching', 'approved') AND coalesce(i.deadline, i.meeting_at) > now()`;

async function liveItems(group: { slug: string; neighborhoodSlug: string }): Promise<{ items: WatchItem[]; citywideItems: WatchItem[] }> {
  const { rows } = await db().query<ScopedIssueRow>(
    `${OPEN_REAL_ISSUES}
       AND (i.group_slug = $1
            OR $2 IN (SELECT jsonb_array_elements_text(i.neighborhood_slugs))
            OR (i.group_slug IS NULL AND jsonb_array_length(i.neighborhood_slugs) = 0))
     ORDER BY coalesce(i.deadline, i.meeting_at)
     LIMIT 40`,
    [group.slug, group.neighborhoodSlug],
  );
  const items: WatchItem[] = [];
  const citywideItems: WatchItem[] = [];
  for (const row of rows) {
    const scope = itemScope(row, group);
    const item = toWatchItem(row, group.slug);
    if (!item || !scope) continue;
    (scope === "group" ? items : citywideItems).push(item);
  }
  return { items, citywideItems };
}

async function liveOutcomes(group: { slug: string; neighborhoodSlug: string }): Promise<Outcome[]> {
  try {
    const { rows } = await db().query<OutcomeDbRow>(
      `SELECT o.id, o.body, to_char(o.meeting_date, 'YYYY-MM-DD') AS meeting_date, o.item_label, o.title, o.result, o.action_text, o.vote, o.source_url
       FROM agent_meeting_outcomes o LEFT JOIN issues i ON i.id = o.issue_id
       WHERE (i.is_sample IS NOT TRUE)
         AND (i.group_slug = $1
              OR $2 IN (SELECT jsonb_array_elements_text(o.neighborhood_slugs))
              OR $2 IN (SELECT jsonb_array_elements_text(i.neighborhood_slugs))
              OR (jsonb_array_length(o.neighborhood_slugs) = 0
                  AND (i.id IS NULL OR (i.group_slug IS NULL AND jsonb_array_length(i.neighborhood_slugs) = 0))))
       ORDER BY o.meeting_date DESC
       LIMIT 10`,
      [group.slug, group.neighborhoodSlug],
    );
    return rows.flatMap((row) => toOutcome(row) ?? []);
  } catch (error) {
    // The backend creates agent_meeting_outcomes; until it exists (or gains neighborhood_slugs), there are no outcomes to show.
    if (errorCode(error) === "42P01" || errorCode(error) === "42703") return [];
    throw error;
  }
}

async function liveMemberCount(groupSlug: string): Promise<number> {
  const { rows } = await db().query<{ n: number }>(
    "SELECT count(*)::int AS n FROM memberships ms JOIN members m ON m.id = ms.member_id WHERE ms.group_slug = $1 AND m.is_sample = false",
    [groupSlug],
  );
  return Number(rows[0]?.n ?? 0);
}

export type LiveGroup = GroupDetail & {
  /** True when items, outcomes and the member count came from the database. */
  live: boolean;
};

/** A group with its real open items (its own and citywide), recent decisions and member count. */
export async function getLiveGroup(slug: string, now = Date.now()): Promise<LiveGroup | null> {
  const group = getGroup(slug, now);
  if (!group) return null;
  if (!hasDatabase()) return { ...group, live: false };
  try {
    const [{ items, citywideItems }, outcomes, memberCount] = await Promise.all([liveItems(group), liveOutcomes(group), liveMemberCount(group.slug)]);
    return { ...group, items, citywideItems, outcomes, memberCount, live: true };
  } catch (error) {
    console.error("[docket] group data unavailable", error);
    // No sample items on the live site, even when the database is briefly unreachable.
    return { ...group, items: [], citywideItems: [], outcomes: [], live: false };
  }
}

export interface LiveGroupList {
  groups: GroupSummary[];
  /** Open items for all of Fremont, which every group sees. */
  citywideCount: number;
}

/** Every group with its real member count and most urgent open item of its own, most members first. */
export async function listLiveGroups(now = Date.now()): Promise<LiveGroupList> {
  const groups = listGroups(now);
  if (!hasDatabase()) return { groups, citywideCount: 0 };
  try {
    const [members, issues] = await Promise.all([
      db().query<{ group_slug: string; n: number }>(
        "SELECT ms.group_slug, count(*)::int AS n FROM memberships ms JOIN members m ON m.id = ms.member_id WHERE m.is_sample = false GROUP BY ms.group_slug",
      ),
      db().query<ScopedIssueRow>(`${OPEN_REAL_ISSUES} ORDER BY coalesce(i.deadline, i.meeting_at) LIMIT 500`),
    ]);
    const counts = new Map(members.rows.map((r) => [r.group_slug, Number(r.n)]));
    const citywideCount = issues.rows.filter((row) => !row.group_slug && (!Array.isArray(row.neighborhood_slugs) || row.neighborhood_slugs.length === 0)).length;
    const list = groups.map((group) => {
      const own = issues.rows.find((row) => itemScope(row, { slug: group.slug, neighborhoodSlug: group.slug }) === "group");
      const urgent = own ? toWatchItem(own, group.slug) : null;
      return {
        ...group,
        memberCount: counts.get(group.slug) ?? 0,
        urgentItem: urgent ? { ref: urgent.ref, title: urgent.title, deadline: urgent.deadline, deadlineKind: urgent.deadlineKind } : null,
      };
    });
    list.sort((a, b) => b.memberCount - a.memberCount || Number(Boolean(b.urgentItem)) - Number(Boolean(a.urgentItem)) || a.name.localeCompare(b.name));
    return { groups: list, citywideCount };
  } catch (error) {
    console.error("[docket] group list unavailable", error);
    return { groups: groups.map((g) => ({ ...g, memberCount: 0, urgentItem: null })), citywideCount: 0 };
  }
}

/** What the agent read and surfaced in the last seven days. Null when there's nothing to report or no data. */
export async function getLiveWeeklyStats(now = Date.now()): Promise<WeeklyStats | null> {
  if (!hasDatabase()) return getWeeklyStats(now);
  try {
    const { rows } = await db().query<{ documents: number; passages: number; surfaced: number; neighborhoods: number }>(
      `SELECT
         (SELECT count(*)::int FROM agent_documents WHERE fetched_at >= now() - interval '7 days') AS documents,
         (SELECT count(*)::int FROM agent_chunks c JOIN agent_documents d ON d.id = c.document_id WHERE d.fetched_at >= now() - interval '7 days') AS passages,
         (SELECT count(*)::int FROM issues WHERE is_sample = false AND status IN ('watching', 'approved') AND surfaced_at >= now() - interval '7 days') AS surfaced,
         (SELECT count(DISTINCT slug)::int FROM (
            SELECT jsonb_array_elements_text(neighborhood_slugs) AS slug FROM issues
            WHERE is_sample = false AND status IN ('watching', 'approved') AND surfaced_at >= now() - interval '7 days'
          ) t) AS neighborhoods`,
    );
    const r = rows[0];
    if (!r || !Number(r.documents)) return null;
    return {
      pagesRead: 0,
      documentsRead: Number(r.documents),
      passagesRead: Number(r.passages),
      itemsSurfaced: Number(r.surfaced),
      neighborhoods: Number(r.neighborhoods),
      windowStart: new Date(now - 7 * DAY_MS).toISOString(),
      windowEnd: new Date(now).toISOString(),
      isCurrentWeek: true,
      source: "live",
    };
  } catch (error) {
    console.error("[docket] weekly stats unavailable", error);
    return null;
  }
}

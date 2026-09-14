import { db } from "./db";
import { getGroup, getWeeklyStats, listGroups } from "./data";
import type { GroupDetail, GroupSummary, ItemStatus, Outcome, WatchItem, WeeklyStats } from "./types";

// Real Docket data for group pages, the groups list and the home page, from Aurora DSQL: agenda items the
// agent surfaced (issues), decisions recorded in meeting minutes (agent_meeting_outcomes, written by the
// backend) and what the agent read this week (agent_documents). Sample rows never appear here.
// Without a database (the static GitHub Pages preview, CI builds) pages keep the saved sample content.

export const hasDatabase = () => Boolean(process.env.DSQL_ENDPOINT?.trim());

const DAY_MS = 24 * 60 * 60 * 1000;
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

async function liveItems(groupSlug: string, neighborhood: string): Promise<WatchItem[]> {
  const { rows } = await db().query<IssueItemRow>(
    `SELECT i.id, i.ref, i.title, i.body, i.meeting_at, i.deadline, i.deadline_kind, i.topic, i.status, i.citation, i.surfaced_at, a.summary
     FROM issues i LEFT JOIN issue_analyses a ON a.issue_id = i.id
     WHERE i.is_sample = false AND i.status IN ('watching', 'approved')
       AND (i.group_slug = $1 OR $2 IN (SELECT jsonb_array_elements_text(i.neighborhood_slugs)))
       AND coalesce(i.deadline, i.meeting_at) > now()
     ORDER BY coalesce(i.deadline, i.meeting_at)
     LIMIT 20`,
    [groupSlug, neighborhood],
  );
  return rows.flatMap((row) => toWatchItem(row, groupSlug) ?? []);
}

async function liveOutcomes(groupSlug: string, neighborhood: string): Promise<Outcome[]> {
  try {
    const { rows } = await db().query<OutcomeDbRow>(
      `SELECT o.id, o.body, to_char(o.meeting_date, 'YYYY-MM-DD') AS meeting_date, o.item_label, o.title, o.result, o.action_text, o.vote, o.source_url
       FROM agent_meeting_outcomes o LEFT JOIN issues i ON i.id = o.issue_id
       WHERE (i.is_sample IS NOT TRUE)
         AND (i.group_slug = $1
              OR $2 IN (SELECT jsonb_array_elements_text(o.neighborhood_slugs))
              OR $2 IN (SELECT jsonb_array_elements_text(i.neighborhood_slugs)))
       ORDER BY o.meeting_date DESC
       LIMIT 10`,
      [groupSlug, neighborhood],
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

/** A group with its real open items, recent decisions and member count. */
export async function getLiveGroup(slug: string, now = Date.now()): Promise<LiveGroup | null> {
  const group = getGroup(slug, now);
  if (!group) return null;
  if (!hasDatabase()) return { ...group, live: false };
  const neighborhood = slugOf(group.district);
  try {
    const [items, outcomes, memberCount] = await Promise.all([liveItems(slug, neighborhood), liveOutcomes(slug, neighborhood), liveMemberCount(slug)]);
    return { ...group, items, outcomes, memberCount, live: true };
  } catch (error) {
    console.error("[docket] group data unavailable", error);
    // No sample items on the live site, even when the database is briefly unreachable.
    return { ...group, items: [], outcomes: [], live: false };
  }
}

/** Every group, with its real member count and most urgent open item. */
export async function listLiveGroups(now = Date.now()): Promise<GroupSummary[]> {
  const groups = listGroups(now);
  if (!hasDatabase()) return groups;
  const details = await Promise.all(groups.map((g) => getLiveGroup(g.slug, now)));
  return groups.map((group, i) => {
    const detail = details[i];
    if (!detail?.live) return { ...group, urgentItem: null };
    const urgent = detail.items[0];
    return {
      ...group,
      memberCount: detail.memberCount,
      urgentItem: urgent ? { ref: urgent.ref, title: urgent.title, deadline: urgent.deadline, deadlineKind: urgent.deadlineKind } : null,
    };
  });
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

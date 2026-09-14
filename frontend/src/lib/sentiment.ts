import { db } from "./db";
import { moderateText } from "./moderation";
import { areaBySlug } from "./places";

// Public sentiment on city agenda items: the letters and comments residents filed in the public record
// (agenda packets, Zoning Administrator correspondence), read by the backend pipeline into
// agent_comment_topics (one row per item) and agent_comments (one row per filed comment, no names).
// This module only reads them, and adds a second safety pass for the page: contact details are redacted
// again and anything that fails the language filter is left out.

export type Stance = "support" | "oppose" | "mixed" | "neutral";
export const STANCES: Stance[] = ["support", "oppose", "mixed", "neutral"];

export interface CommentExcerpt {
  stance: Stance;
  sentAt: string | null;
  authorArea: string | null;
  text: string;
  locator: string;
}

export interface CommentTopic {
  id: string;
  issueId: string | null;
  /** Meeting body, e.g. "City Council". */
  body: string;
  /** YYYY-MM-DD */
  meetingDate: string;
  itemLabel: string;
  title: string;
  neighborhoods: { slug: string; name: string }[];
  counts: Record<Stance, number>;
  total: number;
  themes: { theme: string; count: number }[];
  sourceUrl: string | null;
  model: string;
  generatedAt: string | null;
  excerpts: CommentExcerpt[];
}

export interface SentimentOverview {
  topics: CommentTopic[];
  totals: Record<Stance, number> & { comments: number; topics: number };
  themes: { theme: string; count: number }[];
  /** Filed comments per week (week starting Monday, YYYY-MM-DD), oldest first. */
  byWeek: { week: string; count: number }[];
  /** Neighborhoods the letters or items name, including places mentioned as far away; not where writers live. */
  neighborhoods: { slug: string; name: string; count: number }[];
  /** Where writers said they live, from their own description (most letters don't say). */
  writerAreas: { label: string; count: number }[];
  updatedAt: string | null;
  models: string[];
}

export interface TopicRow {
  id: string;
  issue_id: string | null;
  body: string;
  meeting_date: string;
  item_label: string;
  title: string;
  neighborhood_slugs: unknown;
  comment_count: number;
  support_count: number;
  oppose_count: number;
  mixed_count: number;
  neutral_count: number;
  themes: unknown;
  source_url: string | null;
  generated_at: Date | string | null;
  model: string;
}

export interface CommentRow {
  topic_id: string;
  stance: string;
  sent_at: Date | string | null;
  author_area: string | null;
  excerpt: string;
  locator: string;
}

const MEETING_BODIES: Record<string, string> = {
  city_council: "City Council",
  planning_commission: "Planning Commission",
  zoning_administrator: "Zoning Administrator",
  school_board: "FUSD Board of Education",
};

const EXCERPTS_PER_TOPIC = 3;
const MAX_THEMES = 8;
const MAX_WEEKS = 16;

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE = /(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const STREET =
  /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][A-Za-z'-]*\s+){1,4}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Way|Ct|Court|Ln|Lane|Pl|Place|Pkwy|Parkway|Ter|Terrace|Cir|Circle|Loop|Hwy|Highway)\b\.?/g;

/** Redacts contact details again, even though the pipeline already did, and drops excerpts that fail the language filter. */
export function cleanExcerpt(raw: string): string | null {
  const text = raw
    .replace(EMAIL, "[redacted]")
    .replace(PHONE, "[redacted]")
    .replace(STREET, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  if (!text || !moderateText(text).ok) return null;
  return text;
}

/** Words that describe a stance rather than something residents raised; the stance chart already shows those. */
const STANCE_WORDS = new Set(["support", "supports", "supporting", "in support", "oppose", "opposes", "opposition", "against", "mixed", "neutral", "for", "yes", "no"]);

/** Themes from the pipeline: short, clean labels with counts, most common first. */
export function cleanThemes(raw: unknown): { theme: string; count: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const { theme, count } = item as { theme?: unknown; count?: unknown };
      if (typeof theme !== "string" || typeof count !== "number" || !Number.isInteger(count) || count < 1) return [];
      const label = theme.replace(/\s+/g, " ").trim().slice(0, 80);
      return label && !STANCE_WORDS.has(label.toLowerCase()) && moderateText(label).ok && !/@|\d{3}[\s.-]?\d{4}/.test(label) ? [{ theme: label, count }] : [];
    })
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme))
    .slice(0, MAX_THEMES);
}

/** The Monday (UTC) starting the week of a date, as YYYY-MM-DD. */
export function weekKey(date: Date | string): string {
  const d = new Date(date);
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

const isStance = (value: string): value is Stance => (STANCES as string[]).includes(value);
const count = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);
const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);

const sameText = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Up to three excerpts, preferring different stances so one side doesn't fill the card, and never the
 * same words twice (many residents send the same form letter).
 */
function pickExcerpts(comments: CommentExcerpt[]): CommentExcerpt[] {
  const unique: CommentExcerpt[] = [];
  const seen = new Set<string>();
  for (const comment of comments) {
    const key = sameText(comment.text);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(comment);
  }
  const picked: CommentExcerpt[] = [];
  for (const stance of STANCES) {
    const first = unique.find((c) => c.stance === stance);
    if (first && picked.length < EXCERPTS_PER_TOPIC) picked.push(first);
  }
  for (const comment of unique) {
    if (picked.length >= EXCERPTS_PER_TOPIC) break;
    if (!picked.includes(comment)) picked.push(comment);
  }
  return picked;
}

/** Builds the page's overview from database rows. Pure, so it's tested without a database. */
export function buildOverview(topicRows: TopicRow[], commentRows: CommentRow[]): SentimentOverview {
  const commentsByTopic = new Map<string, CommentExcerpt[]>();
  const weeks = new Map<string, number>();
  const areas = new Map<string, { label: string; count: number }>();
  for (const row of commentRows) {
    if (!isStance(row.stance)) continue;
    if (row.sent_at) weeks.set(weekKey(row.sent_at), (weeks.get(weekKey(row.sent_at)) ?? 0) + 1);
    const ownArea = row.author_area?.replace(/\s+/g, " ").trim().slice(0, 60);
    if (ownArea && moderateText(ownArea).ok && !/\d{3,}/.test(ownArea.replace(/^district \d+$/i, ""))) {
      const key = ownArea.toLowerCase();
      const current = areas.get(key) ?? { label: ownArea, count: 0 };
      current.count += 1;
      areas.set(key, current);
    }
    const text = cleanExcerpt(row.excerpt);
    if (!text) continue;
    const area = row.author_area ? row.author_area.replace(/\s+/g, " ").trim().slice(0, 60) : null;
    const list = commentsByTopic.get(row.topic_id) ?? [];
    list.push({ stance: row.stance, sentAt: iso(row.sent_at), authorArea: area && moderateText(area).ok ? area : null, text, locator: row.locator });
    commentsByTopic.set(row.topic_id, list);
  }

  const topics: CommentTopic[] = topicRows.map((row) => {
    const counts: Record<Stance, number> = {
      support: count(row.support_count),
      oppose: count(row.oppose_count),
      mixed: count(row.mixed_count),
      neutral: count(row.neutral_count),
    };
    const slugs = Array.isArray(row.neighborhood_slugs) ? row.neighborhood_slugs.filter((s): s is string => typeof s === "string") : [];
    return {
      id: row.id,
      issueId: row.issue_id,
      body: MEETING_BODIES[row.body] ?? "Meeting",
      meetingDate: row.meeting_date,
      itemLabel: row.item_label,
      title: row.title,
      neighborhoods: slugs.flatMap((slug) => {
        const area = areaBySlug(slug);
        return area ? [{ slug: area.slug, name: area.name }] : [];
      }),
      counts,
      total: Math.max(count(row.comment_count), STANCES.reduce((s, k) => s + counts[k], 0)),
      themes: cleanThemes(row.themes),
      sourceUrl: row.source_url && /^https?:\/\//i.test(row.source_url) ? row.source_url : null,
      model: row.model,
      generatedAt: iso(row.generated_at),
      excerpts: pickExcerpts(commentsByTopic.get(row.id) ?? []),
    };
  });

  const totals = { support: 0, oppose: 0, mixed: 0, neutral: 0, comments: 0, topics: topics.length };
  const themeTotals = new Map<string, { theme: string; count: number }>();
  const neighborhoodTotals = new Map<string, { slug: string; name: string; count: number }>();
  for (const topic of topics) {
    for (const stance of STANCES) totals[stance] += topic.counts[stance];
    totals.comments += topic.total;
    for (const theme of topic.themes) {
      const key = theme.theme.toLowerCase();
      const current = themeTotals.get(key) ?? { theme: theme.theme, count: 0 };
      current.count += theme.count;
      themeTotals.set(key, current);
    }
    for (const n of topic.neighborhoods) {
      const current = neighborhoodTotals.get(n.slug) ?? { ...n, count: 0 };
      current.count += topic.total;
      neighborhoodTotals.set(n.slug, current);
    }
  }

  const generated = topics.map((t) => t.generatedAt).filter((d): d is string => Boolean(d)).sort();
  return {
    topics,
    totals,
    themes: [...themeTotals.values()].sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme)).slice(0, 10),
    byWeek: [...weeks.entries()]
      .map(([week, n]) => ({ week, count: n }))
      .sort((a, b) => a.week.localeCompare(b.week))
      .slice(-MAX_WEEKS),
    neighborhoods: [...neighborhoodTotals.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 10),
    writerAreas: [...areas.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 8),
    updatedAt: generated.at(-1) ?? null,
    models: [...new Set(topics.map((t) => t.model).filter(Boolean))],
  };
}

/** Public sentiment for the page. Null without a database or before the pipeline has created its tables. */
export async function getSentimentOverview(): Promise<SentimentOverview | null> {
  if (!process.env.DSQL_ENDPOINT?.trim()) return null;
  try {
    const [topics, comments] = await Promise.all([
      db().query<TopicRow>(
        `SELECT id, issue_id, body, to_char(meeting_date, 'YYYY-MM-DD') AS meeting_date, item_label, title, neighborhood_slugs,
                comment_count, support_count, oppose_count, mixed_count, neutral_count, themes, source_url, generated_at, model
         FROM agent_comment_topics
         ORDER BY meeting_date DESC, comment_count DESC
         LIMIT 60`,
      ),
      db().query<CommentRow>(
        `SELECT topic_id, stance, sent_at, author_area, excerpt, locator
         FROM agent_comments
         ORDER BY sent_at DESC NULLS LAST
         LIMIT 3000`,
      ),
    ]);
    return buildOverview(topics.rows, comments.rows);
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "42P01") return null;
    console.error("[docket] public sentiment unavailable", error);
    return null;
  }
}

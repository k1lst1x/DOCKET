import { GROUP_SEEDS } from "../data/fixtures";
import { SAMPLE_FIRST_NAMES, SAMPLE_LAST_INITIALS } from "../data/sample-activity";
import { SAMPLE_POSTS, samplePostId, sampleReplyId } from "../data/sample-posts";
import { moderateText } from "./moderation";
import { areaBySlug } from "./places";
import { hasBlockedLink } from "./post-media";
import type { FeedPost } from "./posts-types";

// Rules and sample data for the home feed that both the server and the browser use.

export const POST_MAX_LENGTH = 500;

/** Post text: up to 500 characters, clean language, http(s) links only. Empty only when allowEmpty (a post with media). */
export function validatePostBody(
  raw: unknown,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): { ok: true; body: string } | { ok: false; error: "invalid_post" | "post_blocked" | "link_blocked" } {
  if (raw !== undefined && raw !== null && typeof raw !== "string") return { ok: false, error: "invalid_post" };
  const body = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
  if ((!body && !allowEmpty) || body.length > POST_MAX_LENGTH) return { ok: false, error: "invalid_post" };
  if (!moderateText(body).ok) return { ok: false, error: "post_blocked" };
  if (hasBlockedLink(body)) return { ok: false, error: "link_blocked" };
  return { ok: true, body };
}

/** "Maria Lopez" → "Maria L." */
export function shortName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first || "Neighbor";
}

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The seed's sample members: same names and home neighborhoods as scripts/dsql-seed.ts. */
export const sampleMemberName = (i: number) =>
  `${SAMPLE_FIRST_NAMES[i % SAMPLE_FIRST_NAMES.length]} ${SAMPLE_LAST_INITIALS[(i * 7) % SAMPLE_LAST_INITIALS.length]}.`;
export const sampleMemberHome = (i: number) => areaBySlug(slugOf(GROUP_SEEDS[i % GROUP_SEEDS.length].district))?.name ?? null;

const HOUR_MS = 3_600_000;

function samplePost(index: number, now: number): FeedPost {
  const post = SAMPLE_POSTS[index];
  const area = post.neighborhood ? areaBySlug(post.neighborhood) : undefined;
  return {
    id: samplePostId(index),
    parentId: null,
    body: post.body,
    media: [],
    createdAt: new Date(now - post.hoursAgo * HOUR_MS).toISOString(),
    author: { name: sampleMemberName(post.author), homeNeighborhood: sampleMemberHome(post.author) },
    neighborhood: area ? { slug: area.slug, name: area.name } : null,
    likeCount: post.likes,
    replyCount: post.replies.length,
    likedByMe: false,
    mine: false,
    sample: true,
    byDocket: false,
    sources: [],
  };
}

/** Saved sample posts, newest first, for a feed scope: "all", or a list of neighborhood slugs. */
export function sampleFeed(now: number, neighborhoods: string[] | null): FeedPost[] {
  return SAMPLE_POSTS.map((_, i) => samplePost(i, now)).filter((p) => !neighborhoods || (p.neighborhood !== null && neighborhoods.includes(p.neighborhood.slug)));
}

export function sampleReplies(postId: string, now: number): FeedPost[] {
  const index = SAMPLE_POSTS.findIndex((_, i) => samplePostId(i) === postId);
  if (index < 0) return [];
  const parent = samplePost(index, now);
  return SAMPLE_POSTS[index].replies.map((reply, r) => ({
    id: sampleReplyId(index, r),
    parentId: parent.id,
    body: reply.body,
    media: [],
    createdAt: new Date(Date.parse(parent.createdAt) + reply.minutesAfter * 60_000).toISOString(),
    author: { name: sampleMemberName(reply.author), homeNeighborhood: sampleMemberHome(reply.author) },
    neighborhood: parent.neighborhood,
    likeCount: 0,
    replyCount: 0,
    likedByMe: false,
    mine: false,
    sample: true,
    byDocket: false,
    sources: [],
  }));
}

/** The fixed member id the Docket agent posts as (db/migrations/0005_docket_posts.sql). */
export const DOCKET_MEMBER_ID = "00000000-0000-4000-8000-00000000d0c7";
const MAX_SOURCES = 8;

/** A Docket post's sources from the database: http(s) links with a title, at most eight. Anything else is dropped. */
export function cleanSources(raw: unknown): { title: string; url: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const { title, url } = item as { title?: unknown; url?: unknown };
      if (typeof url !== "string" || typeof title !== "string") return [];
      try {
        const parsed = new URL(url.trim());
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return [];
        const cleanTitle = title.replace(/\s+/g, " ").trim().slice(0, 200);
        return cleanTitle ? [{ title: cleanTitle, url: parsed.href }] : [];
      } catch {
        return [];
      }
    })
    .slice(0, MAX_SOURCES);
}

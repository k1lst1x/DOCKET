import { db } from "./db";
import { reviewNotice, type ReviewReason, type ReviewStatus } from "./media-moderation";
import { reviewsFor, reviewUpload, type MediaReview } from "./media-review";
import { confirmUploads, mediaBucket, viewUrl } from "./media-storage";
import { moderateText } from "./moderation";
import { areaBySlug } from "./places";
import { validatePostMedia, type StoredMedia } from "./post-media";
import { cleanSources, DOCKET_MEMBER_ID, shortName, validatePostBody } from "./posts-shared";
import type { FeedMedia, FeedPage, FeedPost, PostErrorCode } from "./posts-types";

// Home feed data in Aurora DSQL: posts, replies (one level) and likes.
// Lists are passed to SQL as jsonb arrays (DSQL has no array columns).

export class PostActionError extends Error {
  constructor(readonly code: PostErrorCode) {
    super(code);
    this.name = "PostActionError";
  }
}

export const POST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 20;
const MAX_REPLIES = 100;
const IDS = (param: number) => `(SELECT (jsonb_array_elements_text($${param}::jsonb))::uuid)`;

interface PostRow {
  id: string;
  parent_id: string | null;
  body: string;
  media: StoredMedia[] | null;
  created_at: Date;
  member_id: string;
  name: string;
  is_sample: boolean;
  neighborhood_slug: string | null;
  kind: string | null;
  sources: unknown;
}

const SELECT_POSTS = `SELECT p.id, p.parent_id, p.body, p.media, p.created_at, p.member_id, m.name, p.is_sample, p.neighborhood_slug, p.kind, p.sources
  FROM posts p JOIN members m ON m.id = p.member_id`;

/** Written by the Docket agent: its system member, marked kind = 'docket'. Neither alone is enough. */
const isDocketPost = (row: PostRow) => row.kind === "docket" && row.member_id === DOCKET_MEMBER_ID;

const iso = (d: Date) => new Date(d).toISOString();
const storedMedia = (row: PostRow): StoredMedia[] => (Array.isArray(row.media) ? row.media : []);

/**
 * A post's photos and video, by content-check result. Neighbors get approved files only; the author
 * also sees files still being checked, and a notice for removed ones. A signing failure hides the
 * media, not the post.
 */
async function feedMedia(stored: StoredMedia[], reviews: Map<string, MediaReview>, isAuthor: boolean): Promise<FeedMedia[]> {
  const items = stored
    .map((m) => {
      const review = reviews.get(m.key);
      const status: ReviewStatus = review?.status ?? "pending";
      const reasons: ReviewReason[] = review?.reasons ?? [];
      return { m, status, reasons };
    })
    .filter((item) => isAuthor || item.status === "approved");
  if (!items.length) return [];
  try {
    const urls = await Promise.all(items.map((item) => (item.status === "approved" || item.status === "pending" ? viewUrl(item.m.key) : Promise.resolve(null))));
    return items.flatMap(({ m, status, reasons }, i) => {
      const url = urls[i];
      if (!url && (status === "approved" || status === "pending")) return [];
      return [
        {
          kind: m.kind,
          url,
          width: m.width ?? null,
          height: m.height ?? null,
          durationS: m.durationS ?? null,
          review: status,
          notice: reviewNotice(m.kind, status, reasons, "author"),
        },
      ];
    });
  } catch (error) {
    console.error("[docket] couldn't sign post media links", error);
    return [];
  }
}

/** Adds like and reply counts, the viewer's likes, authors' home neighborhoods and media links. */
async function hydrate(rows: PostRow[], viewerId: string | null): Promise<FeedPost[]> {
  // Anything that fails today's language filter stays visible only to its author.
  const clean = rows.filter((r) => r.member_id === viewerId || moderateText(r.body).ok);
  if (!clean.length) return [];
  const reviews = await reviewsFor(
    clean.flatMap((r) => storedMedia(r).map((m) => ({ key: m.key, memberId: r.member_id, kind: m.kind, contentType: m.contentType }))),
  );
  // A post with photos or a video reaches neighbors only once every file has passed the content check.
  const visible = clean.filter((r) => r.member_id === viewerId || storedMedia(r).every((m) => reviews.get(m.key)?.status === "approved"));
  if (!visible.length) return [];
  const pool = db();
  const postIds = JSON.stringify(visible.map((r) => r.id));
  const memberIds = JSON.stringify([...new Set(visible.map((r) => r.member_id))]);
  const [likes, replies, liked, homes, media] = await Promise.all([
    pool.query<{ post_id: string; n: number }>(`SELECT post_id, count(*)::int AS n FROM post_likes WHERE post_id IN ${IDS(1)} GROUP BY post_id`, [postIds]),
    pool.query<{ parent_id: string; n: number }>(
      `SELECT parent_id, count(*)::int AS n FROM posts WHERE deleted_at IS NULL AND parent_id IN ${IDS(1)} GROUP BY parent_id`,
      [postIds],
    ),
    viewerId
      ? pool.query<{ post_id: string }>(`SELECT post_id FROM post_likes WHERE member_id = $2 AND post_id IN ${IDS(1)}`, [postIds, viewerId])
      : Promise.resolve({ rows: [] as { post_id: string }[] }),
    pool.query<{ member_id: string; neighborhood_slug: string }>(
      `SELECT ms.member_id, g.neighborhood_slug FROM memberships ms JOIN groups g ON g.slug = ms.group_slug
       WHERE ms.member_id IN ${IDS(1)} ORDER BY ms.joined_at`,
      [memberIds],
    ),
    Promise.all(visible.map((r) => feedMedia(storedMedia(r), reviews, r.member_id === viewerId))),
  ]);
  const likeCounts = new Map(likes.rows.map((r) => [r.post_id, Number(r.n)]));
  const replyCounts = new Map(replies.rows.map((r) => [r.parent_id, Number(r.n)]));
  const likedIds = new Set(liked.rows.map((r) => r.post_id));
  const homeOf = new Map<string, string>();
  for (const r of homes.rows) if (!homeOf.has(r.member_id)) homeOf.set(r.member_id, r.neighborhood_slug);

  return visible.map((r, i) => {
    const area = r.neighborhood_slug ? areaBySlug(r.neighborhood_slug) : undefined;
    const home = homeOf.get(r.member_id);
    return {
      id: r.id,
      parentId: r.parent_id,
      body: r.body,
      media: media[i],
      createdAt: iso(r.created_at),
      author: isDocketPost(r)
        ? { name: "Docket", homeNeighborhood: null }
        : {
            name: moderateText(r.name).ok ? shortName(r.name) : "Neighbor",
            homeNeighborhood: home ? (areaBySlug(home)?.name ?? null) : null,
          },
      neighborhood: area ? { slug: area.slug, name: area.name } : null,
      likeCount: likeCounts.get(r.id) ?? 0,
      replyCount: replyCounts.get(r.id) ?? 0,
      likedByMe: likedIds.has(r.id),
      mine: r.member_id === viewerId,
      sample: r.is_sample,
      byDocket: isDocketPost(r),
      sources: isDocketPost(r) ? cleanSources(r.sources) : [],
    };
  });
}

/** The neighborhoods of a member's groups, for the "My neighborhoods" feed. */
export async function memberNeighborhoods(memberId: string): Promise<string[]> {
  const { rows } = await db().query<{ neighborhood_slug: string }>(
    `SELECT DISTINCT g.neighborhood_slug FROM memberships ms JOIN groups g ON g.slug = ms.group_slug WHERE ms.member_id = $1`,
    [memberId],
  );
  return rows.map((r) => r.neighborhood_slug);
}

/**
 * A page of top-level posts, newest first. scope: "all" (every neighborhood and citywide posts),
 * "mine" (the viewer's group neighborhoods) or a neighborhood slug.
 */
export async function listPosts({ scope, before, viewerId }: { scope: string; before: string | null; viewerId: string | null }): Promise<FeedPage> {
  let neighborhoods: string[] | null = null;
  if (scope === "mine") {
    neighborhoods = viewerId ? await memberNeighborhoods(viewerId) : [];
    if (!neighborhoods.length) return { posts: [], nextBefore: null, live: true, scope, neighborhoods: [] };
  } else if (scope !== "all") {
    if (scope === "fremont" || !areaBySlug(scope)) throw new PostActionError("not_found");
    neighborhoods = [scope];
  }

  const params: unknown[] = [];
  const where = ["p.parent_id IS NULL", "p.deleted_at IS NULL"];
  if (neighborhoods) {
    params.push(JSON.stringify(neighborhoods));
    where.push(`p.neighborhood_slug IN (SELECT jsonb_array_elements_text($${params.length}::jsonb))`);
  }
  if (before) {
    params.push(before);
    where.push(`p.created_at < $${params.length}::timestamptz`);
  }
  params.push(PAGE_SIZE + 1);
  const { rows } = await db().query<PostRow>(`${SELECT_POSTS} WHERE ${where.join(" AND ")} ORDER BY p.created_at DESC LIMIT $${params.length}`, params);
  const page = rows.slice(0, PAGE_SIZE);
  return {
    posts: await hydrate(page, viewerId),
    nextBefore: rows.length > PAGE_SIZE && page.length ? iso(page[page.length - 1].created_at) : null,
    live: true,
    scope,
    neighborhoods: neighborhoods ?? [],
  };
}

export async function listReplies(postId: string, viewerId: string | null): Promise<FeedPost[]> {
  const { rows } = await db().query<PostRow>(
    `${SELECT_POSTS} WHERE p.parent_id = $1 AND p.deleted_at IS NULL ORDER BY p.created_at LIMIT ${MAX_REPLIES}`,
    [postId],
  );
  return hydrate(rows, viewerId);
}

/**
 * New post or reply. Replies always attach to the top-level post, inherit its neighborhood and
 * are text only. A post may have photos or a video instead of text; every upload must pass the
 * automatic content check (a video may still be being checked, and stays hidden until it passes).
 */
export async function createPost(
  memberId: string,
  input: { body: unknown; neighborhood: unknown; parentId: unknown; media?: unknown },
): Promise<FeedPost> {
  const mediaCheck = validatePostMedia(input.media, memberId);
  if (!mediaCheck.ok) throw new PostActionError("media_invalid");
  const checked = validatePostBody(input.body, { allowEmpty: mediaCheck.media.length > 0 });
  if (!checked.ok) throw new PostActionError(checked.error);

  let neighborhood: string | null = null;
  let parentId: string | null = null;
  if (input.parentId !== undefined && input.parentId !== null && input.parentId !== "") {
    if (typeof input.parentId !== "string" || !POST_ID_PATTERN.test(input.parentId)) throw new PostActionError("invalid_post");
    if (mediaCheck.media.length) throw new PostActionError("media_invalid");
    const { rows } = await db().query<{ id: string; parent_id: string | null; neighborhood_slug: string | null }>(
      "SELECT id, parent_id, neighborhood_slug FROM posts WHERE id = $1 AND deleted_at IS NULL",
      [input.parentId],
    );
    const parent = rows[0];
    if (!parent) throw new PostActionError("not_found");
    parentId = parent.parent_id ?? parent.id;
    neighborhood = parent.neighborhood_slug;
  } else if (input.neighborhood !== undefined && input.neighborhood !== null && input.neighborhood !== "" && input.neighborhood !== "fremont") {
    if (typeof input.neighborhood !== "string" || !areaBySlug(input.neighborhood)) throw new PostActionError("invalid_post");
    neighborhood = input.neighborhood;
  }

  let media: StoredMedia[] | null = null;
  if (mediaCheck.media.length) {
    if (!mediaBucket()) throw new PostActionError("media_unavailable");
    let reviews: (MediaReview | null)[];
    try {
      reviews = await Promise.all(mediaCheck.media.map((m) => reviewUpload({ key: m.key, memberId, kind: m.kind, contentType: m.contentType })));
    } catch (error) {
      console.error("[docket] media check failed while posting", error);
      throw new PostActionError("media_unavailable");
    }
    if (reviews.some((r) => !r)) throw new PostActionError("media_invalid");
    if (reviews.some((r) => r?.status === "blocked")) throw new PostActionError("media_blocked");
    if (reviews.some((r) => r?.status === "failed")) throw new PostActionError("media_unreviewable");
    media = await confirmUploads(mediaCheck.media);
    if (!media) throw new PostActionError("media_invalid");
  }

  const id = crypto.randomUUID();
  try {
    await db().query("INSERT INTO posts (id, member_id, neighborhood_slug, parent_id, body, media) VALUES ($1, $2, $3, $4, $5, $6::jsonb)", [
      id,
      memberId,
      neighborhood,
      parentId,
      checked.body,
      media ? JSON.stringify(media) : null,
    ]);
  } catch (error) {
    // A missing member or neighborhood row (foreign key).
    if ((error as { code?: string }).code === "23503") throw new PostActionError("invalid_post");
    throw error;
  }
  const { rows } = await db().query<PostRow>(`${SELECT_POSTS} WHERE p.id = $1`, [id]);
  const [post] = await hydrate(rows, memberId);
  if (!post) throw new PostActionError("unavailable");
  return post;
}

/** Soft-deletes the member's own post or reply. */
export async function deletePost(memberId: string, postId: string): Promise<void> {
  const result = await db().query("UPDATE posts SET deleted_at = now() WHERE id = $1 AND member_id = $2 AND deleted_at IS NULL", [postId, memberId]);
  if (result.rowCount) return;
  const { rows } = await db().query<{ member_id: string }>("SELECT member_id FROM posts WHERE id = $1 AND deleted_at IS NULL", [postId]);
  throw new PostActionError(rows[0] ? "forbidden" : "not_found");
}

export async function setLike(memberId: string, postId: string, like: boolean): Promise<{ likeCount: number; likedByMe: boolean }> {
  const { rows } = await db().query<{ id: string }>("SELECT id FROM posts WHERE id = $1 AND deleted_at IS NULL", [postId]);
  if (!rows[0]) throw new PostActionError("not_found");
  if (like) {
    await db().query("INSERT INTO post_likes (post_id, member_id) VALUES ($1, $2) ON CONFLICT (post_id, member_id) DO NOTHING", [postId, memberId]);
  } else {
    await db().query("DELETE FROM post_likes WHERE post_id = $1 AND member_id = $2", [postId, memberId]);
  }
  const counts = await db().query<{ n: number; mine: number }>(
    "SELECT count(*)::int AS n, sum(CASE WHEN member_id = $2 THEN 1 ELSE 0 END)::int AS mine FROM post_likes WHERE post_id = $1",
    [postId, memberId],
  );
  return { likeCount: Number(counts.rows[0]?.n ?? 0), likedByMe: Number(counts.rows[0]?.mine ?? 0) > 0 };
}

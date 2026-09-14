import { db } from "./db";
import { moderateText } from "./moderation";
import { areaBySlug } from "./places";
import { shortName, validatePostBody } from "./posts-shared";
import type { FeedPage, FeedPost, PostErrorCode } from "./posts-types";

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
  created_at: Date;
  member_id: string;
  name: string;
  is_sample: boolean;
  neighborhood_slug: string | null;
}

const SELECT_POSTS = `SELECT p.id, p.parent_id, p.body, p.created_at, p.member_id, m.name, p.is_sample, p.neighborhood_slug
  FROM posts p JOIN members m ON m.id = p.member_id`;

const iso = (d: Date) => new Date(d).toISOString();

/** Adds like and reply counts, the viewer's likes and authors' home neighborhoods. */
async function hydrate(rows: PostRow[], viewerId: string | null): Promise<FeedPost[]> {
  // Anything that fails today's language filter stays visible only to its author.
  const visible = rows.filter((r) => r.member_id === viewerId || moderateText(r.body).ok);
  if (!visible.length) return [];
  const pool = db();
  const postIds = JSON.stringify(visible.map((r) => r.id));
  const memberIds = JSON.stringify([...new Set(visible.map((r) => r.member_id))]);
  const [likes, replies, liked, homes] = await Promise.all([
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
  ]);
  const likeCounts = new Map(likes.rows.map((r) => [r.post_id, Number(r.n)]));
  const replyCounts = new Map(replies.rows.map((r) => [r.parent_id, Number(r.n)]));
  const likedIds = new Set(liked.rows.map((r) => r.post_id));
  const homeOf = new Map<string, string>();
  for (const r of homes.rows) if (!homeOf.has(r.member_id)) homeOf.set(r.member_id, r.neighborhood_slug);

  return visible.map((r) => {
    const area = r.neighborhood_slug ? areaBySlug(r.neighborhood_slug) : undefined;
    const home = homeOf.get(r.member_id);
    return {
      id: r.id,
      parentId: r.parent_id,
      body: r.body,
      createdAt: iso(r.created_at),
      author: {
        name: moderateText(r.name).ok ? shortName(r.name) : "Neighbor",
        homeNeighborhood: home ? (areaBySlug(home)?.name ?? null) : null,
      },
      neighborhood: area ? { slug: area.slug, name: area.name } : null,
      likeCount: likeCounts.get(r.id) ?? 0,
      replyCount: replyCounts.get(r.id) ?? 0,
      likedByMe: likedIds.has(r.id),
      mine: r.member_id === viewerId,
      sample: r.is_sample,
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

/** New post or reply. Replies always attach to the top-level post and inherit its neighborhood. */
export async function createPost(memberId: string, input: { body: unknown; neighborhood: unknown; parentId: unknown }): Promise<FeedPost> {
  const checked = validatePostBody(input.body);
  if (!checked.ok) throw new PostActionError(checked.error);

  let neighborhood: string | null = null;
  let parentId: string | null = null;
  if (input.parentId !== undefined && input.parentId !== null && input.parentId !== "") {
    if (typeof input.parentId !== "string" || !POST_ID_PATTERN.test(input.parentId)) throw new PostActionError("invalid_post");
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

  const id = crypto.randomUUID();
  try {
    await db().query("INSERT INTO posts (id, member_id, neighborhood_slug, parent_id, body) VALUES ($1, $2, $3, $4, $5)", [
      id,
      memberId,
      neighborhood,
      parentId,
      checked.body,
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

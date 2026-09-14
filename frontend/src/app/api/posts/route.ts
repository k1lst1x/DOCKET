import { NextResponse } from "next/server";
import { getSession, isSameOrigin } from "@/lib/auth";
import { noStore, postFailure } from "@/lib/post-http";
import { createPost, listPosts, PostActionError } from "@/lib/posts";
import { sampleFeed } from "@/lib/posts-shared";
import { allowPostRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const SCOPE = /^(all|mine|[a-z0-9]+(-[a-z0-9]+)*)$/;

/** A page of the home feed. ?scope=all|mine|<neighborhood slug>&before=<ISO time> */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") ?? "all";
  if (scope.length > 60 || !SCOPE.test(scope)) return postFailure("not_found");
  const rawBefore = url.searchParams.get("before");
  const before = rawBefore && Number.isFinite(Date.parse(rawBefore)) ? new Date(rawBefore).toISOString() : null;
  const session = await getSession();
  try {
    return NextResponse.json(await listPosts({ scope, before, viewerId: session?.memberId ?? null }), { headers: noStore });
  } catch (error) {
    if (error instanceof PostActionError) return postFailure(error.code);
    console.error("[docket] feed failed; serving saved sample posts", error);
    // Database unreachable: saved sample posts, read-only.
    const neighborhoods = scope === "all" ? null : scope === "mine" ? [] : [scope];
    return NextResponse.json(
      { posts: before ? [] : sampleFeed(Date.now(), neighborhoods), nextBefore: null, live: false, scope, neighborhoods: neighborhoods ?? [] },
      { headers: noStore },
    );
  }
}

/** Post, or reply with parentId. Body: { body, neighborhood?, parentId?, media? } (media from /api/posts/media uploads) */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: noStore });
  if (!allowPostRequest(request)) return postFailure("busy");
  const session = await getSession();
  if (!session) return postFailure("not_signed_in");
  const input = (await request.json().catch(() => null)) as { body?: unknown; neighborhood?: unknown; parentId?: unknown; media?: unknown } | null;
  if (!input) return postFailure("invalid_post");
  try {
    const post = await createPost(session.memberId, { body: input.body, neighborhood: input.neighborhood, parentId: input.parentId, media: input.media });
    return NextResponse.json({ post }, { status: 201, headers: noStore });
  } catch (error) {
    if (error instanceof PostActionError) return postFailure(error.code);
    console.error("[docket] post failed", error);
    return postFailure("unavailable");
  }
}

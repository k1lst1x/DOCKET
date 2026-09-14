import { NextResponse } from "next/server";
import { getSession, isSameOrigin } from "@/lib/auth";
import { noStore, postFailure } from "@/lib/post-http";
import { POST_ID_PATTERN, PostActionError, setLike } from "@/lib/posts";
import { allowLikeRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

async function handle(request: Request, params: Promise<{ id: string }>, like: boolean) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: noStore });
  if (!allowLikeRequest(request)) return postFailure("busy");
  const { id } = await params;
  if (!POST_ID_PATTERN.test(id)) return postFailure("not_found");
  const session = await getSession();
  if (!session) return postFailure("not_signed_in");
  try {
    return NextResponse.json(await setLike(session.memberId, id, like), { headers: noStore });
  } catch (error) {
    if (error instanceof PostActionError) return postFailure(error.code);
    console.error("[docket] like failed", error);
    return postFailure("unavailable");
  }
}

/** Like a post. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, params, true);
}

/** Remove your like. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, params, false);
}

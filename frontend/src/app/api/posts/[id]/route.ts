import { NextResponse } from "next/server";
import { getSession, isSameOrigin } from "@/lib/auth";
import { noStore, postFailure } from "@/lib/post-http";
import { deletePost, POST_ID_PATTERN, PostActionError } from "@/lib/posts";
import { allowPostRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Delete your own post or reply. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: noStore });
  if (!allowPostRequest(request)) return postFailure("busy");
  const { id } = await params;
  if (!POST_ID_PATTERN.test(id)) return postFailure("not_found");
  const session = await getSession();
  if (!session) return postFailure("not_signed_in");
  try {
    await deletePost(session.memberId, id);
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) {
    if (error instanceof PostActionError) return postFailure(error.code);
    console.error("[docket] delete post failed", error);
    return postFailure("unavailable");
  }
}

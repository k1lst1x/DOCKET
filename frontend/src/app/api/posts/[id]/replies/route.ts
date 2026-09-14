import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { noStore, postFailure } from "@/lib/post-http";
import { listReplies, POST_ID_PATTERN } from "@/lib/posts";
import { sampleReplies } from "@/lib/posts-shared";

export const dynamic = "force-dynamic";

/** Replies to a post, oldest first. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!POST_ID_PATTERN.test(id)) return postFailure("not_found");
  const session = await getSession();
  try {
    return NextResponse.json({ replies: await listReplies(id, session?.memberId ?? null), live: true }, { headers: noStore });
  } catch (error) {
    console.error("[docket] replies failed; serving saved sample replies", error);
    return NextResponse.json({ replies: sampleReplies(id, Date.now()), live: false }, { headers: noStore });
  }
}

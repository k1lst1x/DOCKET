import { NextResponse } from "next/server";
import { getSession, isSameOrigin } from "@/lib/auth";
import { reviewNotice } from "@/lib/media-moderation";
import { reviewUpload } from "@/lib/media-review";
import { mediaBucket } from "@/lib/media-storage";
import { noStore, postFailure } from "@/lib/post-http";
import { validatePostMedia } from "@/lib/post-media";
import { allowMediaRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Checks one of your uploads right after it finishes, so the post box can say whether it can be
 * posted. Body: { key, contentType, durationS? } → { status, notice }. Posting checks again.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: noStore });
  if (!allowMediaRequest(request)) return postFailure("busy");
  const session = await getSession();
  if (!session) return postFailure("not_signed_in");
  if (!mediaBucket()) return postFailure("media_unavailable");
  const input = (await request.json().catch(() => null)) as { key?: unknown; contentType?: unknown; durationS?: unknown } | null;
  const checked = validatePostMedia(input ? [{ key: input.key, contentType: input.contentType, durationS: input.durationS }] : null, session.memberId);
  if (!checked.ok || checked.media.length !== 1) return postFailure("media_invalid");
  const [media] = checked.media;
  try {
    const review = await reviewUpload({ key: media.key, memberId: session.memberId, kind: media.kind, contentType: media.contentType });
    if (!review) return postFailure("media_invalid");
    return NextResponse.json({ status: review.status, notice: reviewNotice(media.kind, review.status, review.reasons, "composer") }, { headers: noStore });
  } catch (error) {
    console.error("[docket] media check failed", error);
    return postFailure("media_unavailable");
  }
}

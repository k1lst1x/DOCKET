import { NextResponse } from "next/server";
import { getSession, isSameOrigin } from "@/lib/auth";
import { createUploadTicket, mediaBucket } from "@/lib/media-storage";
import { validateUploadRequest } from "@/lib/post-media";
import { noStore, postFailure } from "@/lib/post-http";
import { allowMediaRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** An upload ticket for one photo or video. Body: { contentType, size, durationS? } */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: noStore });
  if (!allowMediaRequest(request)) return postFailure("busy");
  const session = await getSession();
  if (!session) return postFailure("not_signed_in");
  if (!mediaBucket()) return postFailure("media_unavailable");
  const checked = validateUploadRequest(await request.json().catch(() => null));
  if (!checked.ok) return postFailure("media_invalid");
  try {
    return NextResponse.json(await createUploadTicket(session.memberId, checked), { status: 201, headers: noStore });
  } catch (error) {
    console.error("[docket] media upload ticket failed", error);
    return postFailure("media_unavailable");
  }
}

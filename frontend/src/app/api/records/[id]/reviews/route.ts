import { NextResponse } from "next/server";
import { getSession, isSameOrigin } from "@/lib/auth";
import { allowReviewRequest } from "@/lib/rate-limit";
import { UUID } from "@/lib/record-detail";
import { deleteRecordReview, listRecordReviews, RecordReviewError, saveRecordReview } from "@/lib/record-reviews";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

type Params = Promise<{ id: string }>;

const STATUS = { not_signed_in: 401, not_found: 404, invalid_review: 400, review_blocked: 422, busy: 429, unavailable: 503 } as const;
const fail = (error: keyof typeof STATUS) => NextResponse.json({ error }, { status: STATUS[error], headers: noStore });

async function act(request: Request, params: Params, work: (memberId: string, id: string, body: unknown) => Promise<void>) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "not_found" }, { status: 403, headers: noStore });
  if (!allowReviewRequest(request)) return fail("busy");
  const { id } = await params;
  if (!UUID.test(id)) return fail("not_found");
  const session = await getSession();
  if (!session) return fail("not_signed_in");
  const payload = request.method === "POST" ? ((await request.json().catch(() => null)) as { body?: unknown } | null) : null;
  try {
    await work(session.memberId, id, payload?.body);
    return NextResponse.json({ reviews: await listRecordReviews(id, session.memberId) }, { headers: noStore });
  } catch (error) {
    if (error instanceof RecordReviewError) return fail(error.code);
    console.error("[docket] record review failed", error);
    return fail("unavailable");
  }
}

/** Saves (or replaces) the signed-in neighbor's review of a record. Body: { body: string }. */
export function POST(request: Request, { params }: { params: Params }) {
  return act(request, params, (memberId, id, body) => saveRecordReview(memberId, id, body));
}

/** Removes the signed-in neighbor's review of a record. */
export function DELETE(request: Request, { params }: { params: Params }) {
  return act(request, params, (memberId, id) => deleteRecordReview(memberId, id));
}

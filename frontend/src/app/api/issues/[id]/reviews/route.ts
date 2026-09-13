import { NextResponse } from "next/server";
import { getSession, isSameOrigin } from "@/lib/auth";
import { ISSUE_ID_PATTERN, issueFailure } from "@/lib/issue-http";
import { getIssueDetail, IssueActionError, postReview } from "@/lib/issues";
import { allowReviewRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Write or update your review. Only allowed after voting or passing on the issue. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "not_found" }, { status: 403 });
  if (!allowReviewRequest(request)) return issueFailure("busy");

  const { id } = await params;
  if (id.length > 120 || !ISSUE_ID_PATTERN.test(id)) return issueFailure("not_found");

  const session = await getSession();
  if (!session) return issueFailure("not_signed_in");

  const body = (await request.json().catch(() => null)) as { rating?: unknown; body?: unknown } | null;
  const rating = typeof body?.rating === "number" ? body.rating : NaN;
  const text = typeof body?.body === "string" ? body.body : "";

  try {
    await postReview(session.memberId, id, rating, text);
    const detail = await getIssueDetail(id, session.memberId);
    if (!detail) return issueFailure("not_found");
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof IssueActionError) return issueFailure(error.code);
    console.error("[docket] review failed", error);
    return issueFailure("unavailable");
  }
}

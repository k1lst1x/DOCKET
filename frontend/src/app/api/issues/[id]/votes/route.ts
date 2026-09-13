import { NextResponse } from "next/server";
import { getSession, isSameOrigin } from "@/lib/auth";
import { ISSUE_ID_PATTERN, issueFailure } from "@/lib/issue-http";
import { castVote, getIssueDetail, IssueActionError } from "@/lib/issues";
import { allowVoteRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Cast or change a vote. Identity comes from the session, never the body. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "not_found" }, { status: 403 });
  if (!allowVoteRequest(request)) return issueFailure("busy");

  const { id } = await params;
  if (id.length > 120 || !ISSUE_ID_PATTERN.test(id)) return issueFailure("not_found");

  const session = await getSession();
  if (!session) return issueFailure("not_signed_in");

  const body = (await request.json().catch(() => null)) as { pollId?: unknown; choice?: unknown } | null;
  const pollId = typeof body?.pollId === "string" ? body.pollId : "";
  const choice = typeof body?.choice === "string" ? body.choice : "";
  if (!pollId || pollId.length > 160 || !choice || choice.length > 64) return issueFailure("invalid_choice");

  try {
    await castVote(session.memberId, id, pollId, choice);
    const detail = await getIssueDetail(id, session.memberId);
    if (!detail) return issueFailure("not_found");
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof IssueActionError) return issueFailure(error.code);
    console.error("[docket] vote failed", error);
    return issueFailure("unavailable");
  }
}

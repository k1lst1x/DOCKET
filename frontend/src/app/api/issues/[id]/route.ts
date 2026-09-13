import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { fallbackIssueDetail } from "@/lib/issue-fallback";
import { ISSUE_ID_PATTERN, issueFailure } from "@/lib/issue-http";
import { getIssueDetail } from "@/lib/issues";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id.length > 120 || !ISSUE_ID_PATTERN.test(id)) return issueFailure("not_found");

  const session = await getSession();
  try {
    const detail = await getIssueDetail(id, session?.memberId ?? null);
    if (!detail) return issueFailure("not_found");
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[docket] issue detail failed; serving saved content", error);
    // Database unreachable: show the saved summary without votes instead of an error.
    const fallback = fallbackIssueDetail(id, Boolean(session));
    if (fallback) return NextResponse.json(fallback, { headers: { "Cache-Control": "no-store" } });
    return issueFailure("unavailable");
  }
}

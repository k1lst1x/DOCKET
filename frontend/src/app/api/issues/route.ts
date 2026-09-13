import { NextResponse } from "next/server";
import { fallbackIssueMarkers } from "@/lib/issue-fallback";
import { listIssueMarkers } from "@/lib/issues";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** Issues with a location and their current vote totals, for the Places map. */
export async function GET() {
  try {
    return NextResponse.json({ live: true, issues: await listIssueMarkers() }, { headers: noStore });
  } catch (error) {
    console.error("[docket] issue markers failed; serving saved issues", error);
    return NextResponse.json({ live: false, issues: fallbackIssueMarkers() }, { headers: noStore });
  }
}

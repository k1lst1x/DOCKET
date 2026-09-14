import { NextResponse } from "next/server";
import { listIssueMarkers } from "@/lib/issues";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** Real issues with a location and their current vote totals, for the Places map. */
export async function GET() {
  try {
    return NextResponse.json({ live: true, issues: await listIssueMarkers() }, { headers: noStore });
  } catch (error) {
    // No saved sample issues on the live site: an empty map layer until the database answers again.
    console.error("[docket] issue markers failed", error);
    return NextResponse.json({ live: false, issues: [] }, { headers: noStore });
  }
}

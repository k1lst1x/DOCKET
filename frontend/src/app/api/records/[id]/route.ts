import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getRecordDetail, UUID } from "@/lib/record-detail";
import { listRecordReviews } from "@/lib/record-reviews";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

type Params = Promise<{ id: string }>;

/** A neighborhood record for its popup: details, chart data, related records, reviews and who's viewing. */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: noStore });
  if (!process.env.DSQL_ENDPOINT?.trim()) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: noStore });
  try {
    const session = await getSession();
    const [detail, reviews] = await Promise.all([getRecordDetail(id), listRecordReviews(id, session?.memberId ?? null)]);
    if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404, headers: noStore });
    return NextResponse.json({ detail, reviews, viewer: { signedIn: Boolean(session) } }, { headers: noStore });
  } catch (error) {
    console.error("[docket] record unavailable", error);
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: noStore });
  }
}

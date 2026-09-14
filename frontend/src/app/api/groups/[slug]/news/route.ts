import { NextResponse } from "next/server";
import { getGroup } from "@/lib/data";
import { getNewsSnapshot } from "@/lib/news/feed";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** News, live incidents, alerts and city issues for one neighborhood group. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const group = getGroup((await params).slug);
  if (!group) return NextResponse.json({ error: "not_found" }, { status: 404, headers: noStore });
  return NextResponse.json(await getNewsSnapshot(group), { headers: noStore });
}

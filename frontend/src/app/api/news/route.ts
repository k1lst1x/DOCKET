import { NextResponse } from "next/server";
import { getNewsCatalog } from "@/lib/news/feed";

export const dynamic = "force-dynamic";

/** Every recent Fremont story, community post and live incident, tagged by neighborhood. */
export async function GET() {
  return NextResponse.json(await getNewsCatalog(), { headers: { "Cache-Control": "no-store" } });
}

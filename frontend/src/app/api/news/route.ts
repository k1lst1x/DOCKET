import { NextResponse } from "next/server";
import { getNewsCatalog } from "@/lib/news/feed";

export const dynamic = "force-dynamic";

/**
 * Every recent Fremont story, community post and live incident, tagged by neighborhood. The same for
 * everyone, so the CDN may keep it for a minute: most visitors get it without waiting on the server.
 */
export async function GET() {
  return NextResponse.json(await getNewsCatalog(), { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" } });
}

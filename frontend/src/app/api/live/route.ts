import { NextResponse } from "next/server";
import { getLiveSnapshot } from "@/lib/live/snapshot";

export const dynamic = "force-dynamic";

/**
 * Live incidents and alerts around Fremont. Each upstream feed is cached on its own interval, and the
 * response is the same for everyone, so the CDN may keep it for 30 seconds.
 */
export async function GET() {
  const snapshot = await getLiveSnapshot();
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120" } });
}

import { NextResponse } from "next/server";
import { getLiveSnapshot } from "@/lib/live/snapshot";

export const dynamic = "force-dynamic";

/** Live incidents and alerts around Fremont. Each upstream feed is cached on its own interval. */
export async function GET() {
  const snapshot = await getLiveSnapshot();
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}

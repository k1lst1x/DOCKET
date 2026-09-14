import { NextResponse } from "next/server";
import { getLiveWeeklyStats } from "@/lib/live-data";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ stats: await getLiveWeeklyStats() }, { headers: { "Cache-Control": "no-store" } });
}

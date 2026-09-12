import { NextResponse } from "next/server";
import { getWeeklyStats } from "@/lib/data";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ stats: getWeeklyStats() });
}

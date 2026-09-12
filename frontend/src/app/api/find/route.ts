import { NextResponse, type NextRequest } from "next/server";
import { findGroups } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await findGroups(request.nextUrl.searchParams.get("address") ?? "");
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

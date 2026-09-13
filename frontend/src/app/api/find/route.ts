import { NextResponse, type NextRequest } from "next/server";
import { findGroups } from "@/lib/data";
import { allowLookupRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!allowLookupRequest(request)) {
    return NextResponse.json({ error: "Too many address lookups. Try again shortly." }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  const result = await findGroups(request.nextUrl.searchParams.get("address") ?? "");
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

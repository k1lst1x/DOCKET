import { NextResponse } from "next/server";
import { listGroups } from "@/lib/data";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ groups: listGroups() });
}

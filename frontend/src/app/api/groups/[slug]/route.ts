import { NextResponse } from "next/server";
import { getGroup } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const group = getGroup((await params).slug);
  if (!group) return NextResponse.json({ error: "Group not found." }, { status: 404 });
  return NextResponse.json(group);
}

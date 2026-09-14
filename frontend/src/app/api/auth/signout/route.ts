import { NextResponse } from "next/server";
import { clearSessionCookie, isSameOrigin } from "@/lib/auth";
import { noStore } from "@/lib/auth-http";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "failed" }, { status: 403 });
  const response = NextResponse.json({ ok: true }, { headers: noStore });
  clearSessionCookie(response);
  return response;
}

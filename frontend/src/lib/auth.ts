import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { Role } from "./types";

export const SESSION_COOKIE = "docket_session";
const SESSION_TTL_S = 60 * 60 * 24 * 30;
const MAGIC_LINK_TTL_S = 60 * 30;

export interface Session {
  memberId: string;
  groups: { groupId: string; slug: string; role: Role }[];
}

interface SessionPayload extends Session {
  typ: "session";
  exp: number;
}

export interface MagicPayload {
  typ: "magic";
  memberId: string;
  next: string;
  nonce: string;
  exp: number;
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set to at least 32 characters in production.");
  }
  return "docket-development-only-secret-never-use-in-production";
}

const nowS = () => Math.floor(Date.now() / 1000);

function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify<T extends { typ: string; exp: number }>(token: string, typ: T["typ"]): T | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    if (payload.typ !== typ || typeof payload.exp !== "number" || payload.exp < nowS()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Only same-site paths; blocks open redirects such as "//evil.example". */
export function safeNextPath(next: unknown, fallback = "/"): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
    ? next
    : fallback;
}

export function createMagicLink(memberId: string, next: string): string {
  const token = sign({
    typ: "magic",
    memberId,
    next: safeNextPath(next),
    nonce: randomBytes(12).toString("base64url"),
    exp: nowS() + MAGIC_LINK_TTL_S,
  } satisfies MagicPayload);
  const origin = process.env.APP_URL ?? "http://localhost:3000";
  return `${origin}/api/auth/verify?token=${encodeURIComponent(token)}`;
}

export const readMagicToken = (token: string) => verify<MagicPayload>(token, "magic");

/** No mail provider yet: in development the link is printed to the server console. */
export function deliverMagicLink(email: string, url: string): void {
  if (process.env.NODE_ENV !== "production") {
    console.info(`\n[docket] Magic link for ${email}\n${url}\n`);
  } else {
    console.info("[docket] Magic link issued; email delivery is not configured.");
  }
}

export function setSessionCookie(response: NextResponse, session: Session): void {
  const token = sign({ ...session, typ: "session", exp: nowS() + SESSION_TTL_S } satisfies SessionPayload);
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
}

/** Server components and route handlers read identity only from here. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = verify<SessionPayload>(token, "session");
  return payload ? { memberId: payload.memberId, groups: payload.groups } : null;
}

/** Rejects cross-site form posts. Browsers always send Origin on POST. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

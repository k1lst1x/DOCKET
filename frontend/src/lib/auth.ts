import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { Role } from "./types";

// Members register and log in with an email and password, checked against our own database (members.ts,
// passwords.ts). After that the app keeps its own signed, httpOnly session cookie so server components can read
// who is signed in without a database call.

export const SESSION_COOKIE = "docket_session";
const SESSION_TTL_S = 60 * 60 * 24 * 30;

export interface Session {
  memberId: string; // members.id
  name: string;
  email: string;
  groups: { slug: string; role: Role }[];
}

/** A group someone is joining, with the preferences from the join form. */
export interface PendingJoin {
  slug: string;
  topics: string[];
  otherTopic: string | null;
  canSpeakEvenings: boolean;
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

export function signToken<T extends object>(payload: T & { typ: string }, ttlS: number, now = nowS()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + ttlS })).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyToken<T>(token: string, typ: string, now = nowS()): (T & { typ: string; exp: number }) | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { typ: string; exp: number };
    if (payload.typ !== typ || typeof payload.exp !== "number" || payload.exp < now) return null;
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

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

export function setSessionCookie(response: NextResponse, session: Session): void {
  response.cookies.set(SESSION_COOKIE, signToken({ ...session, typ: "session" }, SESSION_TTL_S), cookieOptions(SESSION_TTL_S));
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
}

/** Server components and route handlers read identity only from here. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = verifyToken<Session>(token, "session");
  return s ? { memberId: s.memberId, name: s.name, email: s.email, groups: s.groups } : null;
}

/** Rejects cross-site form posts. Browsers always send Origin on POST. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    // `host` alone would accept an HTTP origin for an HTTPS request on the
    // same host. Compare complete origins so the scheme is part of the CSRF
    // boundary too. On managed hosts, request.url can be the internal origin
    // behind a reverse proxy; APP_URL is the configured public origin.
    const publicUrl = process.env.APP_URL?.trim() || request.url;
    return new URL(origin).origin === new URL(publicUrl).origin;
  } catch {
    return false;
  }
}

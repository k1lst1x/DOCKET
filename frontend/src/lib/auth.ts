import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { Role } from "./types";

// Identity comes from Amazon Cognito (email one-time codes). After Cognito
// verifies a code, the app keeps its own signed, httpOnly session cookie so
// server components can read who is signed in without calling AWS.

export const SESSION_COOKIE = "docket_session";
export const PENDING_COOKIE = "docket_pending";
const SESSION_TTL_S = 60 * 60 * 24 * 30;
const PENDING_TTL_S = 60 * 15;

export interface Session {
  memberId: string; // Cognito user "sub"
  name: string;
  email: string;
  groups: { slug: string; role: Role }[];
}

export interface PendingJoin {
  slug: string;
  topics: string[];
  otherTopic: string | null;
  canSpeakEvenings: boolean;
}

/** A code has been emailed; this remembers what to finish once it comes back. */
export interface PendingSignIn {
  kind: "signup" | "signin";
  email: string;
  name: string | null;
  cognitoSession: string | null;
  join: PendingJoin | null;
  next: string;
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
  const [body, mac] = token.split(".");
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

export function setPendingCookie(response: NextResponse, pending: PendingSignIn): void {
  response.cookies.set(PENDING_COOKIE, signToken({ ...pending, typ: "pending" }, PENDING_TTL_S), cookieOptions(PENDING_TTL_S));
}

export function clearPendingCookie(response: NextResponse): void {
  response.cookies.set(PENDING_COOKIE, "", cookieOptions(0));
}

export async function readPending(): Promise<PendingSignIn | null> {
  const token = (await cookies()).get(PENDING_COOKIE)?.value;
  if (!token) return null;
  const p = verifyToken<PendingSignIn>(token, "pending");
  return p
    ? { kind: p.kind, email: p.email, name: p.name, cognitoSession: p.cognitoSession, join: p.join, next: safeNextPath(p.next) }
    : null;
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

// Account form rules, shared by the sign-in and join forms (instant feedback) and the API routes (the real check).

import { moderateText } from "./moderation";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AccountFieldErrors = Partial<Record<"name" | "email" | "password", string>>;

type Parsed<T> = { ok: true; value: T } | { ok: false; errors: AccountFieldErrors };

const record = (body: unknown) => (body && typeof body === "object" ? (body as Record<string, unknown>) : {});
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
// Passwords are kept exactly as typed, spaces included.
const raw = (value: unknown) => (typeof value === "string" ? value : "");

export function nameProblem(name: string): string | undefined {
  if (!name) return "Tell us what to call you.";
  if (name.length > 80) return "Keep your name under 80 characters.";
  if (!moderateText(name).ok) return "Choose a name without swear words or slurs. Neighbors see it next to your reviews.";
  return undefined;
}

export function emailProblem(email: string): string | undefined {
  if (!email) return "Enter your email address.";
  if (email.length > 254 || !EMAIL.test(email)) return "That email address doesn't look complete.";
  return undefined;
}

export function passwordProblem(password: string): string | undefined {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Keep it under ${PASSWORD_MAX} characters.`;
  return undefined;
}

function settle<T>(errors: AccountFieldErrors, value: T): Parsed<T> {
  const found = Object.fromEntries(Object.entries(errors).filter(([, message]) => message)) as AccountFieldErrors;
  return Object.keys(found).length ? { ok: false, errors: found } : { ok: true, value };
}

export function parseRegistration(body: unknown): Parsed<{ name: string; email: string; password: string }> {
  const b = record(body);
  const name = text(b.name);
  const email = text(b.email).toLowerCase();
  const password = raw(b.password);
  return settle({ name: nameProblem(name), email: emailProblem(email), password: passwordProblem(password) }, { name, email, password });
}

export function parseLogin(body: unknown): Parsed<{ email: string; password: string }> {
  const b = record(body);
  const email = text(b.email).toLowerCase();
  const password = raw(b.password);
  const passwordError = !password ? "Enter your password." : password.length > PASSWORD_MAX ? "That password is too long." : undefined;
  return settle({ email: emailProblem(email), password: passwordError }, { email, password });
}

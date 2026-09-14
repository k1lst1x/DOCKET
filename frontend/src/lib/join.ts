// Shared by the join form (instant feedback) and the API (the real check).

import { emailProblem, nameProblem, passwordProblem } from "./account-fields";

export interface JoinFields {
  name: string;
  email: string;
  password: string;
  topics: string[];
  otherTopic: string | null;
  canSpeakEvenings: boolean;
}

export type JoinFieldErrors = Partial<Record<"name" | "email" | "password" | "otherTopic", string>>;

type Preferences = Omit<JoinFields, "name" | "email" | "password">;

/** Topics and speaker preference only: used when a signed-in member joins another group. */
export function parsePreferences(body: unknown, watchlist: string[]): { ok: true; value: Preferences } | { ok: false; errors: JoinFieldErrors } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const topics = Array.isArray(b.topics)
    ? [...new Set(b.topics.filter((t): t is string => typeof t === "string" && watchlist.includes(t)))]
    : [];
  const otherTopic = typeof b.otherTopic === "string" ? b.otherTopic.trim() : "";
  if (otherTopic.length > 120) return { ok: false, errors: { otherTopic: "Keep it under 120 characters." } };
  return { ok: true, value: { topics, otherTopic: otherTopic || null, canSpeakEvenings: b.canSpeakEvenings === true } };
}

/** The full join form for someone who isn't signed in: account fields plus preferences. */
export function parseJoin(body: unknown, watchlist: string[]): { ok: true; value: JoinFields } | { ok: false; errors: JoinFieldErrors } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const errors: JoinFieldErrors = {};

  const name = typeof b.name === "string" ? b.name.trim() : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const password = typeof b.password === "string" ? b.password : "";
  const nameError = nameProblem(name);
  const emailError = emailProblem(email);
  const passwordError = passwordProblem(password);
  if (nameError) errors.name = nameError;
  if (emailError) errors.email = emailError;
  if (passwordError) errors.password = passwordError;

  const preferences = parsePreferences(body, watchlist);
  if (!preferences.ok) Object.assign(errors, preferences.errors);

  if (Object.keys(errors).length > 0 || !preferences.ok) return { ok: false, errors };
  return { ok: true, value: { name, email, password, ...preferences.value } };
}

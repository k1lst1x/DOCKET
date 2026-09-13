// Shared by the join form (instant feedback) and the API (the real check).

import { moderateText } from "./moderation";

export interface JoinFields {
  name: string;
  email: string;
  topics: string[];
  otherTopic: string | null;
  canSpeakEvenings: boolean;
}

export type JoinFieldErrors = Partial<Record<"name" | "email" | "otherTopic", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Topics and speaker preference only: used when a signed-in member joins another group. */
export function parsePreferences(
  body: unknown,
  watchlist: string[],
): { ok: true; value: Omit<JoinFields, "name" | "email"> } | { ok: false; errors: JoinFieldErrors } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const topics = Array.isArray(b.topics)
    ? [...new Set(b.topics.filter((t): t is string => typeof t === "string" && watchlist.includes(t)))]
    : [];
  const otherTopic = typeof b.otherTopic === "string" ? b.otherTopic.trim() : "";
  if (otherTopic.length > 120) return { ok: false, errors: { otherTopic: "Keep it under 120 characters." } };
  return { ok: true, value: { topics, otherTopic: otherTopic || null, canSpeakEvenings: b.canSpeakEvenings === true } };
}

export function parseJoin(
  body: unknown,
  watchlist: string[],
): { ok: true; value: JoinFields } | { ok: false; errors: JoinFieldErrors } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const errors: JoinFieldErrors = {};

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) errors.name = "Tell us what to call you.";
  else if (name.length > 80) errors.name = "Keep your name under 80 characters.";
  else if (!moderateText(name).ok) errors.name = "Choose a name without swear words or slurs. Neighbors see it next to your reviews.";

  const email = typeof b.email === "string" ? b.email.trim() : "";
  if (!email) errors.email = "We need an email to send your sign-in link.";
  else if (email.length > 254 || !EMAIL.test(email)) errors.email = "That email address doesn't look complete.";

  const topics = Array.isArray(b.topics)
    ? [...new Set(b.topics.filter((t): t is string => typeof t === "string" && watchlist.includes(t)))]
    : [];

  const otherTopic = typeof b.otherTopic === "string" ? b.otherTopic.trim() : "";
  if (otherTopic.length > 120) errors.otherTopic = "Keep it under 120 characters.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name, email, topics, otherTopic: otherTopic || null, canSpeakEvenings: b.canSpeakEvenings === true },
  };
}

import { expect, it } from "vitest";
import { parseLogin, parseRegistration } from "./account-fields";
import { parseJoin } from "./join";

it("checks registration fields and normalizes the email", () => {
  expect(parseRegistration({ name: " Ana ", email: " Ana@Example.COM ", password: "longenough" })).toEqual({
    ok: true,
    value: { name: "Ana", email: "ana@example.com", password: "longenough" },
  });
  const bad = parseRegistration({ name: "", email: "ana@", password: "short" });
  expect(bad.ok ? [] : Object.keys(bad.errors).sort()).toEqual(["email", "name", "password"]);
});

it("keeps passwords exactly as typed and asks for one on login", () => {
  expect(parseLogin({ email: "a@b.co", password: "  spaced  " })).toEqual({ ok: true, value: { email: "a@b.co", password: "  spaced  " } });
  expect(parseLogin({ email: "a@b.co", password: "" })).toEqual({ ok: false, errors: { password: "Enter your password." } });
  expect(parseLogin(null).ok).toBe(false);
});

it("requires a password on the join form for people who aren't signed in", () => {
  const joined = parseJoin({ name: "Ana", email: "ANA@example.com", password: "longenough", topics: ["Parks", "nope"] }, ["Parks"]);
  expect(joined).toEqual({
    ok: true,
    value: { name: "Ana", email: "ana@example.com", password: "longenough", topics: ["Parks"], otherTopic: null, canSpeakEvenings: false },
  });
  const missing = parseJoin({ name: "Ana", email: "ana@example.com" }, ["Parks"]);
  expect(missing.ok ? {} : missing.errors).toEqual({ password: "Use at least 8 characters." });
});

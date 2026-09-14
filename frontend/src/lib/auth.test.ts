import { describe, expect, it } from "vitest";
import { isSameOrigin, safeNextPath, signToken, verifyToken } from "./auth";

describe("signed tokens", () => {
  it("round-trips and rejects the wrong type, expiry and forged bodies", () => {
    const now = 1_000;
    const token = signToken({ typ: "pending", email: "a@example.com" }, 60, now);

    expect(verifyToken<{ email: string }>(token, "pending", now + 30)?.email).toBe("a@example.com");
    expect(verifyToken(token, "session", now + 30)).toBeNull();
    expect(verifyToken(token, "pending", now + 61)).toBeNull();

    const mac = token.split(".")[1];
    const forged = Buffer.from(JSON.stringify({ typ: "pending", email: "b@example.com", exp: now + 60 })).toString("base64url");
    expect(verifyToken(`${forged}.${mac}`, "pending", now)).toBeNull();
    expect(verifyToken("not-a-token", "pending", now)).toBeNull();
  });
});

it("only allows same-site next paths", () => {
  expect(safeNextPath("/g/niles-neighbors")).toBe("/g/niles-neighbors");
  expect(safeNextPath("//evil.example")).toBe("/");
  expect(safeNextPath("https://evil.example")).toBe("/");
  expect(safeNextPath("/\\evil.example")).toBe("/");
  expect(safeNextPath(undefined, "/groups")).toBe("/groups");
});

it("requires the full origin for cookie-backed mutations", () => {
  expect(isSameOrigin(new Request("https://docket.example/api/posts", { headers: { origin: "https://docket.example" } }))).toBe(true);
  expect(isSameOrigin(new Request("https://docket.example/api/posts", { headers: { origin: "http://docket.example" } }))).toBe(false);
  expect(isSameOrigin(new Request("https://docket.example/api/posts", { headers: { origin: "https://docket.example:444" } }))).toBe(false);
  expect(isSameOrigin(new Request("https://docket.example/api/posts"))).toBe(false);
});

it("uses the configured public origin behind a reverse proxy", () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = "https://docket.example";
  try {
    expect(isSameOrigin(new Request("http://internal-host/api/posts", { headers: { origin: "https://docket.example" } }))).toBe(true);
    expect(isSameOrigin(new Request("http://internal-host/api/posts", { headers: { origin: "https://attacker.example" } }))).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});

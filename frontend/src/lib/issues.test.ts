import { describe, expect, it } from "vitest";
import { isClosed } from "./issues";

describe("isClosed", () => {
  const now = Date.parse("2026-09-13T12:00:00.000Z");

  it("closes decided issues and issues past their deadline", () => {
    expect(isClosed("decided", null, now)).toBe(true);
    expect(isClosed("watching", new Date(now - 1), now)).toBe(true);
  });

  it("keeps an issue open through its exact deadline and until it is decided", () => {
    expect(isClosed("watching", new Date(now), now)).toBe(false);
    expect(isClosed("watching", new Date(now + 1), now)).toBe(false);
  });
});

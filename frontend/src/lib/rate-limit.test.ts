import { describe, expect, it } from "vitest";
import { clientKeyFromHeaders, FixedWindowLimiter } from "./rate-limit";

describe("FixedWindowLimiter", () => {
  it("rejects excess requests and accepts a new window", () => {
    const limiter = new FixedWindowLimiter(2, 10, 1_000);
    expect(limiter.allow("client", 0)).toBe(true);
    expect(limiter.allow("client", 1)).toBe(true);
    expect(limiter.allow("client", 2)).toBe(false);
    expect(limiter.allow("client", 1_001)).toBe(true);
  });

  it("bounds the number of tracked client keys", () => {
    const limiter = new FixedWindowLimiter(1, 2, 1_000);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("b", 0)).toBe(true);
    expect(limiter.allow("spoofed-c", 0)).toBe(false);
  });
});

it("uses the first forwarded address as the client key", () => {
  expect(clientKeyFromHeaders(new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }))).toBe("198.51.100.7");
  expect(clientKeyFromHeaders(new Headers())).toBe("unknown");
});

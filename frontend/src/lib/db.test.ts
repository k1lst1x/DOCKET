import { expect, it } from "vitest";
import { isStale } from "./db";

it("discards pooled connections left idle through a freeze or past their lifetime", () => {
  const now = 10_000_000;
  // Brand-new connection, never released yet.
  expect(isStale(now, undefined, now)).toBe(false);
  // Reused within the idle window.
  expect(isStale(now, now - 5_000, now - 60_000)).toBe(false);
  // Idle longer than the pool's idle timer: the server was frozen, the socket may be dead.
  expect(isStale(now, now - 31_000, now - 60_000)).toBe(true);
  // Open for more than 50 minutes: DSQL ends connections at 60.
  expect(isStale(now, now - 1_000, now - 51 * 60_000)).toBe(true);
});

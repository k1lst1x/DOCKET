import { afterEach, describe, expect, it } from "vitest";
import { resetStoreForTests, spendMagicNonce } from "./store";

afterEach(resetStoreForTests);

describe("magic-link replay state", () => {
  it("rejects a replay and discards expired nonce records", () => {
    expect(spendMagicNonce("nonce", 1_000, 0)).toBe(true);
    expect(spendMagicNonce("nonce", 1_000, 1)).toBe(false);
    expect(spendMagicNonce("nonce", 3_000, 2_000)).toBe(true);
  });
});

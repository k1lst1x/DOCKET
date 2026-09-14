import { expect, it } from "vitest";
import { dummyHash, hashPassword, verifyPassword } from "./passwords";

it("hashes with a fresh salt and matches only the exact password", async () => {
  const first = await hashPassword("correct horse battery");
  const second = await hashPassword("correct horse battery");
  expect(first).toMatch(/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
  expect(first).not.toBe(second);
  expect(await verifyPassword("correct horse battery", first)).toBe(true);
  expect(await verifyPassword("correct horse batterY", first)).toBe(false);
  expect(await verifyPassword(" correct horse battery", first)).toBe(false);
});

it("never matches a missing or malformed hash", async () => {
  const salt = Buffer.from("salt").toString("base64url");
  const key = Buffer.from("key").toString("base64url");
  for (const stored of [null, undefined, "", "plain", "scrypt$16384$8$1", `bcrypt$16384$8$1$${salt}$${key}`, `scrypt$abc$8$1$${salt}$${key}`, `scrypt$3$8$1$${salt}$${key}`, `scrypt$16384$8$1$$${key}`]) {
    expect(await verifyPassword("anything", stored)).toBe(false);
  }
});

it("uses a real hash when there is no account, which nothing matches by accident", async () => {
  expect(await dummyHash()).toMatch(/^scrypt\$/);
  expect(await verifyPassword("password123", await dummyHash())).toBe(false);
});

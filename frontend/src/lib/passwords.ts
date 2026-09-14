import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Password hashing with scrypt (built into Node). Stored as "scrypt$N$r$p$salt$hash" with base64url parts,
// so the cost can be raised later without breaking existing hashes. Form rules live in account-fields.ts.

const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, keyLength, { ...options, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** True when the password matches the stored hash. Missing or malformed hashes never match. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  const sane = Number.isInteger(n) && n > 1 && n <= 1 << 20 && (n & (n - 1)) === 0 && Number.isInteger(r) && r > 0 && r <= 32 && Number.isInteger(p) && p > 0 && p <= 16;
  if (!sane || !salt.length || !expected.length) return false;
  try {
    const key = await derive(password, salt, expected.length, { N: n, r, p });
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;

/** A real hash to check when no account matches, so a wrong email takes as long as a wrong password. */
export function dummyHash(): Promise<string> {
  return (dummy ??= hashPassword("docket-no-such-account"));
}

import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Format: scrypt$<salt b64>$<hash b64> */
export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pw, salt, 32, PARAMS);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [kind, s, h] = stored.split("$");
  if (kind !== "scrypt" || !s || !h) return false;
  const expected = Buffer.from(h, "base64");
  const hash = await scryptAsync(pw, Buffer.from(s, "base64"), expected.length, PARAMS);
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

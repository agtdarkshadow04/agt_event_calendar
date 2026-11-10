import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Passwords are stored only as salted one-way scrypt hashes (Node's built-in
 * implementation, so no extra native dependency). Format:
 * `scrypt$N$r$p$<salt base64>$<hash base64>` (AGT web app spec AUTH-2).
 */

/**
 * The supported scrypt parameter profiles. A stored hash with any other parameters never verifies. Add a profile
 * only together with the code that rehashes on the next successful login (AUTH-2).
 */
export const SCRYPT_PROFILES = [{ N: 32768, r: 8, p: 1 }] as const;

/**
 * The fixed options of every scrypt call, hashing and verifying. `maxmem` is never computed from a stored hash:
 * these parameters need just over Node's default 32 MiB.
 */
const SCRYPT_OPTIONS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;
/** The trimmed admin username is 1–64 characters (AUTH-3). */
export const MAX_USERNAME_LENGTH = 64;

/** The result of checking a password against a stored hash. `unsupported`: the stored hash can never verify. */
export type PasswordCheck = 'match' | 'mismatch' | 'unsupported';

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_BYTES, SCRYPT_OPTIONS, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** Standard base64 that decodes to exactly `bytes` bytes, or null. */
function decodeBase64(text: string, bytes: number): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  const decoded = Buffer.from(text, 'base64');
  return decoded.length === bytes && decoded.toString('base64') === text ? decoded : null;
}

/** Parses a stored hash, or returns null if it is malformed or uses unsupported parameters. */
export function parseStoredHash(stored: string): { salt: Buffer; key: Buffer } | null {
  const fields = stored.split('$');
  if (fields.length !== 6 || fields[0] !== 'scrypt') return null;
  const [, n, r, p, saltText, keyText] = fields;
  const supported = SCRYPT_PROFILES.some((profile) => n === String(profile.N) && r === String(profile.r) && p === String(profile.p));
  if (!supported) return null;
  const salt = decodeBase64(saltText, SALT_BYTES);
  const key = decodeBase64(keyText, KEY_BYTES);
  return salt && key ? { salt, key } : null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return ['scrypt', SCRYPT_OPTIONS.N, SCRYPT_OPTIONS.r, SCRYPT_OPTIONS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Checks a password. A malformed or unsupported stored hash is rejected without calling scrypt. */
export async function verifyPassword(password: string, stored: string): Promise<PasswordCheck> {
  const parsed = parseStoredHash(stored);
  if (!parsed) return 'unsupported';
  const key = await derive(password, parsed.salt);
  return timingSafeEqual(key, parsed.key) ? 'match' : 'mismatch';
}

/**
 * Checks the admin password. A stored hash that can never verify gets a server log `error` (never the hash itself),
 * and the caller answers it like a wrong password (AUTH-2).
 */
export async function checkAdminPassword(log: FastifyBaseLogger, password: string, stored: string): Promise<boolean> {
  const result = await verifyPassword(password, stored);
  if (result === 'unsupported') {
    log.error({ source: 'auth' }, 'The stored admin password hash is malformed or uses unsupported scrypt parameters.');
  }
  return result === 'match';
}

/** Constant-time comparison of two secrets of any length. */
export function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  const length = Math.max(left.length, right.length, 1);
  const paddedLeft = Buffer.alloc(length);
  const paddedRight = Buffer.alloc(length);
  left.copy(paddedLeft);
  right.copy(paddedRight);
  return timingSafeEqual(paddedLeft, paddedRight) && left.length === right.length;
}

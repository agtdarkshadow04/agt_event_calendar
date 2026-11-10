import { randomBytes } from 'node:crypto';
import { createChallenge } from 'altcha-lib';
import type { Challenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/sha';
import altchaFastify from 'altcha-lib/frameworks/fastify';
import type { AppContext } from './context';
import type { Db } from './db';
import { createSecretIfMissing, getSecret, markAltchaUsed } from './repository';

/**
 * Self-hosted ALTCHA proof-of-work captcha. The HMAC key is generated (32 random bytes) and stored in `app_secrets`
 * at startup and after a restore whose data has none (ALT-2). Requests only read it. It is never configured:
 * the deprecated `altcha.hmacKey` in config.yaml is ignored.
 */
const HMAC_KEY = 'altcha_hmac_key';

/** Creates the HMAC key if the database has none. Returns true if it created one. */
export function ensureAltchaKey(db: Db): boolean {
  return createSecretIfMissing(db, HMAC_KEY, () => randomBytes(32).toString('hex'));
}

function hmacKey(context: AppContext): string {
  const key = getSecret(context.db, HMAC_KEY);
  if (key === null) throw new Error('The ALTCHA HMAC key is missing; it is created at startup.');
  return key;
}

export async function createAltchaChallenge(context: AppContext): Promise<Challenge> {
  return createChallenge({
    algorithm: 'SHA-256',
    cost: context.config.altcha.cost,
    deriveKey,
    hmacSignatureSecret: hmacKey(context),
    expiresAt: Math.floor(Date.now() / 1000) + context.config.altcha.challengeTtlSeconds,
  });
}

/** Verifies a widget payload. Each solved challenge is accepted once; expired ones never. */
export async function verifyAltchaPayload(context: AppContext, payload: string | undefined): Promise<string | null> {
  if (!payload) return 'The captcha was not completed.';
  const secret = hmacKey(context);
  const ttl = context.config.altcha.challengeTtlSeconds;
  const store = {
    get: () => false,
    set: () => undefined,
    setIfAbsent: (key: string) => markAltchaUsed(context.db, key, ttl),
  };
  const { verify } = altchaFastify.create({ hmacSignatureSecret: secret, deriveKey });
  const result = await verify(payload, deriveKey, secret, undefined, store);
  if (result.error === null) return null;
  if (result.verification && 'expired' in result.verification && result.verification.expired) {
    return 'The captcha challenge has expired. Please verify again.';
  }
  return `The captcha could not be verified: ${result.error}`;
}

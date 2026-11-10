import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from './context';
import { HttpError } from './http';
import type { RecoverySession } from './dataWrite';
import { createSession, deleteSession, getAdmin, sessionExpiry, sessionValid } from './repository';

export const SESSION_COOKIE = 'agt_session';
export const CSRF_HEADER = 'x-agt-request';

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function isSecureRequest(context: AppContext, request: FastifyRequest): boolean {
  const mode = context.config.secureCookie;
  return mode === 'auto' ? request.protocol === 'https' : mode;
}

export function startSession(context: AppContext, request: FastifyRequest, reply: FastifyReply): void {
  const token = randomBytes(32).toString('base64url');
  const expires = createSession(context.db, tokenHash(token), context.config.sessionTtlHours);
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecureRequest(context, request),
    path: '/',
    expires: new Date(expires),
  });
}

export function endSession(context: AppContext, request: FastifyRequest, reply: FastifyReply): void {
  const token = request.cookies[SESSION_COOKIE];
  if (token) {
    try {
      deleteSession(context.db, tokenHash(token));
    } catch {
      // The database may have been replaced by a restore.
    }
  }
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'strict', secure: isSecureRequest(context, request) });
}

function requestTokenHash(request: FastifyRequest): string | null {
  const token = request.cookies?.[SESSION_COOKIE];
  return token ? tokenHash(token) : null;
}

/**
 * While a restore is failed, only the recovery session is valid, and the session table of the half-restored data is
 * never consulted (BAK-11). Otherwise the session must exist and not have expired.
 */
export function hasValidSession(context: AppContext, request: FastifyRequest): boolean {
  const hash = requestTokenHash(request);
  if (context.operation.state === 'restore_failed') return context.operation.isRecoverySession(hash);
  return hash !== null && sessionValid(context.db, hash);
}

/** The caller's session as a recovery session, recorded when their restore starts (BAK-11). */
export function recoverySessionOf(context: AppContext, request: FastifyRequest): RecoverySession | null {
  const hash = requestTokenHash(request);
  if (hash === null) return null;
  const expires = sessionExpiry(context.db, hash);
  const admin = getAdmin(context.db);
  return expires && admin ? { tokenHash: hash, username: admin.username, expiresAt: Date.parse(expires) } : null;
}

/** The only requests admitted while a restore is failed: the recovery session's session check and restores. */
export function isRecoveryRequest(context: AppContext, request: FastifyRequest): boolean {
  const route = `${request.method} ${request.routeOptions.url ?? ''}`;
  if (route !== 'GET /api/admin/session' && route !== 'POST /api/admin/restore') return false;
  return context.operation.isRecoverySession(requestTokenHash(request));
}

/**
 * State-changing admin/setup requests must carry a custom header. Browsers
 * cannot add it cross-origin without a CORS preflight (which this server never
 * approves); together with SameSite=Strict cookies this blocks CSRF.
 */
export function requireCsrfHeader(request: FastifyRequest): void {
  if (request.headers[CSRF_HEADER] !== '1') {
    throw new HttpError(403, 'csrf', `Missing ${CSRF_HEADER} header.`);
  }
}


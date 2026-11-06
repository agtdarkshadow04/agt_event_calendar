import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from './context';
import { HttpError } from './http';
import { createSession, deleteSession, sessionValid } from './repository';

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

export function hasValidSession(context: AppContext, request: FastifyRequest): boolean {
  const token = request.cookies[SESSION_COOKIE];
  return Boolean(token) && sessionValid(context.db, tokenHash(token!));
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


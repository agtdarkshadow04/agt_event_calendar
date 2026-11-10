/**
 * Audit log (AGT web app spec LOG-10..14). One `onResponse` hook records every
 * request that must be audited, so no route can be forgotten. Handlers only add
 * the target and a summary of the change with `setAudit()`; never passwords,
 * Markdown bodies, file contents or the submitted values of failed fields.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { FieldError } from '../src/lib/validation';
import type { AppContext } from './context';
import type { ActorType, AuditOutcome } from './logs';
import { getAdmin } from './repository';
import { SESSION_COOKIE, hasValidSession } from './session';

/** Sent by the app's own UI on every request (LOG-13). Informational only: never used for authorization. */
export const CLIENT_HEADER = 'x-agt-client';

export interface AuditInfo {
  targetType?: string | null;
  targetId?: string | null;
  /** Overrides the actor: the submitter's AGT username, or the admin after a successful setup or login. */
  actor?: string | null;
  actorType?: ActorType;
  /** A JSON summary of the change (LOG-14). */
  details?: Record<string, unknown>;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Target and details for this request's audit entry, set by handlers through `setAudit()`. */
    audit?: AuditInfo;
    /** The admin's username when the request arrived with a valid session (set by the audit hook). */
    auditAdmin?: string | null;
  }
  interface FastifyContextConfig {
    /** Audit this GET route: sensitive reads such as backup downloads and log exports (LOG-11). */
    audit?: boolean;
  }
}

/** Adds target and details to the request's audit entry; details are merged. */
export function setAudit(request: FastifyRequest, info: AuditInfo): void {
  const current = request.audit ?? {};
  request.audit = { ...current, ...info, details: { ...current.details, ...info.details } };
}

/** Records why a request failed: the error code and the names (never the values) of failed fields. */
export function auditFailure(request: FastifyRequest, code: string, fields?: FieldError[]): void {
  const failedFields = fields ? [...new Set(fields.map((field) => field.field))] : undefined;
  setAudit(request, { details: { error: code, ...(failedFields?.length ? { failedFields } : {}) } });
}

export function outcomeFor(statusCode: number): AuditOutcome {
  if (statusCode < 400) return 'success';
  if (statusCode === 401 || statusCode === 403) return 'denied';
  if (statusCode === 429) return 'rate_limited';
  return 'failure';
}

/**
 * Every non-GET /api/ route; GET routes marked `config.audit`; every 401/403
 * from /api/admin/; every 429 from any route. Unknown routes are not audited.
 */
export function shouldAudit(method: string, route: string | undefined, statusCode: number, configAudit: boolean): boolean {
  if (!route || !route.startsWith('/api/')) return false;
  if (statusCode === 429) return true;
  if (route.startsWith('/api/admin/') && (statusCode === 401 || statusCode === 403)) return true;
  if (method !== 'GET' && method !== 'HEAD') return true;
  return configAudit;
}

/** A list of the field names whose values differ between two versions of a resource. */
export function changedFields(before: object, after: object, ignore: string[] = ['id', 'createdAt', 'updatedAt']): string[] {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => !ignore.includes(key) && JSON.stringify(a[key]) !== JSON.stringify(b[key])).sort();
}

export function registerAudit(app: FastifyInstance, context: AppContext): void {
  // Who made the request is decided before the handler runs: a logout or a
  // restore ends the session, and a login starts one.
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/') || !request.cookies?.[SESSION_COOKIE]) return;
    try {
      request.auditAdmin = hasValidSession(context, request) ? getAdmin(context.db)?.username ?? null : null;
    } catch {
      request.auditAdmin = null;
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    try {
      const route = request.routeOptions.url;
      const statusCode = reply.statusCode;
      if (!shouldAudit(request.method, route, statusCode, request.routeOptions.config?.audit === true)) return;
      const audit = request.audit ?? {};
      const admin = request.auditAdmin ?? null;
      const actorType = audit.actorType ?? (admin !== null ? 'admin' : 'anonymous');
      context.logs.writeAudit({
        actorType,
        actor: audit.actor !== undefined ? audit.actor : actorType === 'admin' ? admin : null,
        ipHash: context.logs.ipHash(request.ip),
        client: request.headers[CLIENT_HEADER] === 'web' ? 'web' : 'api',
        action: (request.routeOptions.schema?.operationId as string | undefined) ?? `${request.method} ${route}`,
        method: request.method,
        route: route!,
        targetType: audit.targetType ?? null,
        targetId: audit.targetId ?? null,
        outcome: outcomeFor(statusCode),
        statusCode,
        requestId: String(request.id),
        details: audit.details ?? {},
      });
    } catch (error) {
      request.log.error({ source: 'http', err: error }, 'Could not record the audit entry');
    }
  });
}

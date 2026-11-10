/**
 * Admin routes for the server log and the audit log (AGT web app spec LOG-18,
 * LOG-22). Registered inside the admin plugin, so its session and CSRF hook
 * applies. There is deliberately no route that changes or deletes audit entries.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Readable } from 'node:stream';
import { setAudit } from './audit';
import type { AppContext } from './context';
import { HttpError } from './http';
import { AUDIT_LOG_COLUMNS, SERVER_LOG_COLUMNS, decodeCursor, exportFileName, exportStream } from './logs';
import type { AuditLogFilters, ServerLogFilters } from './logs';
import { SECURITY, errorResponses } from './openapi';
import {
  AuditLogExportQuerySchema, AuditLogPageSchema, AuditLogQuerySchema, NoContent, ServerLogExportQuerySchema,
  ServerLogPageSchema, ServerLogQuerySchema, ServerLogSummarySchema, binaryResponse,
} from './schemas';

const EXPORT_TYPES = { jsonl: 'application/x-ndjson; charset=utf-8', csv: 'text/csv; charset=utf-8' } as const;
const exportResponse = binaryResponse('The log as JSON Lines or CSV, newest first.', ['application/x-ndjson', 'text/csv']);

function timeFilter(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new HttpError(400, 'invalid_request', `${name} must be an ISO 8601 timestamp.`);
  return new Date(time).toISOString();
}

function cursorFrom(cursor: string | undefined): number | null {
  if (cursor === undefined) return null;
  const seq = decodeCursor(cursor);
  if (seq === null) throw new HttpError(400, 'invalid_request', 'The cursor is invalid.');
  return seq;
}

function serverFilters(query: ServerLogFilters): ServerLogFilters {
  return { level: query.level, source: query.source, q: query.q, from: timeFilter(query.from, 'from'), to: timeFilter(query.to, 'to') };
}

function auditFilters(query: AuditLogFilters): AuditLogFilters {
  return {
    actorType: query.actorType, action: query.action, outcome: query.outcome, targetType: query.targetType,
    targetId: query.targetId, q: query.q, from: timeFilter(query.from, 'from'), to: timeFilter(query.to, 'to'),
  };
}

/** Only the filters that were set, for the audit entry of an export. */
const usedFilters = (filters: object) =>
  Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined));

function sendExport(reply: FastifyReply, kind: 'server' | 'audit', format: 'jsonl' | 'csv', stream: Readable) {
  reply.header('Content-Type', EXPORT_TYPES[format]);
  reply.header('Content-Disposition', `attachment; filename="${exportFileName(kind, format)}"`);
  // A stream is sent as is; the response schema only documents it.
  return reply.send(stream as unknown as string);
}

export function registerLogRoutes(fastify: FastifyInstance, context: AppContext): void {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // ------------------------------------------------------------- server log

  app.get('/api/admin/logs/server', {
    config: { writesData: false },
    schema: {
      operationId: 'listServerLog', tags: ['logs'], summary: 'Lists server log entries, newest first.',
      security: SECURITY.adminRead,
      querystring: ServerLogQuerySchema,
      response: { 200: ServerLogPageSchema, ...errorResponses },
    },
  }, async (request) =>
    context.logs.listServer(serverFilters(request.query), request.query.limit ?? 50, cursorFrom(request.query.cursor)));

  app.get('/api/admin/logs/server/export', {
    config: { writesData: false, audit: true },
    schema: {
      operationId: 'exportServerLog', tags: ['logs'], summary: 'Downloads the filtered server log as JSON Lines or CSV.',
      security: SECURITY.adminRead,
      querystring: ServerLogExportQuerySchema,
      response: { 200: exportResponse, ...errorResponses },
    },
  }, async (request, reply) => {
    const format = request.query.format ?? 'jsonl';
    const filters = serverFilters(request.query);
    setAudit(request, { targetType: 'server_log', details: { format, filters: usedFilters(filters) } });
    return sendExport(reply, 'server', format, exportStream(context.logs.iterateServer(filters), SERVER_LOG_COLUMNS, format));
  });

  app.get('/api/admin/logs/server/summary', {
    config: { writesData: false },
    schema: {
      operationId: 'getServerLogSummary', tags: ['logs'],
      summary: 'Counts the warnings and errors written since the server log was last opened.',
      security: SECURITY.adminRead,
      response: { 200: ServerLogSummarySchema, ...errorResponses },
    },
  }, async () => context.logs.serverSummary());

  app.post('/api/admin/logs/server/seen', {
    config: { writesData: false },
    schema: {
      operationId: 'markServerLogSeen', tags: ['logs'], summary: 'Marks every server log entry written so far as seen.',
      security: SECURITY.adminWrite,
      response: { 200: ServerLogSummarySchema, ...errorResponses },
    },
  }, async (request) => {
    context.logs.markServerSeen();
    setAudit(request, { targetType: 'server_log' });
    return context.logs.serverSummary();
  });

  app.delete('/api/admin/logs/server', {
    config: { writesData: false },
    schema: {
      operationId: 'clearServerLog', tags: ['logs'], summary: 'Deletes every server log entry. The audit log cannot be cleared.',
      security: SECURITY.adminWrite,
      response: { 204: NoContent, ...errorResponses },
    },
  }, async (request, reply) => {
    const deleted = context.logs.clearServer();
    setAudit(request, { targetType: 'server_log', details: { deleted } });
    return reply.status(204).send(null);
  });

  // ------------------------------------------------------------- audit log

  app.get('/api/admin/logs/audit', {
    config: { writesData: false },
    schema: {
      operationId: 'listAuditLog', tags: ['logs'], summary: 'Lists audit log entries, newest first.',
      security: SECURITY.adminRead,
      querystring: AuditLogQuerySchema,
      response: { 200: AuditLogPageSchema, ...errorResponses },
    },
  }, async (request) =>
    context.logs.listAudit(auditFilters(request.query), request.query.limit ?? 50, cursorFrom(request.query.cursor)));

  app.get('/api/admin/logs/audit/export', {
    config: { writesData: false, audit: true },
    schema: {
      operationId: 'exportAuditLog', tags: ['logs'], summary: 'Downloads the filtered audit log as JSON Lines or CSV.',
      security: SECURITY.adminRead,
      querystring: AuditLogExportQuerySchema,
      response: { 200: exportResponse, ...errorResponses },
    },
  }, async (request, reply) => {
    const format = request.query.format ?? 'jsonl';
    const filters = auditFilters(request.query);
    setAudit(request, { targetType: 'audit_log', details: { format, filters: usedFilters(filters) } });
    return sendExport(reply, 'audit', format, exportStream(context.logs.iterateAudit(filters), AUDIT_LOG_COLUMNS, format));
  });
}

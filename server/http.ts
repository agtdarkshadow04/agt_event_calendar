import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyRequest } from 'fastify';
import type { FieldError } from '../src/lib/validation';
import { formatMegabytes } from './images';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly fields?: FieldError[],
  ) {
    super(message);
  }
}

/** True for an IPv4 or IPv6 loopback address, including IPv4-mapped IPv6 (`::ffff:127.0.0.1`). */
export function isLoopbackAddress(ip: string): boolean {
  const address = ip.toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  if (isIP(address) === 4) return address.startsWith('127.');
  return address === '::1' || address === '0:0:0:0:0:0:0:1';
}

export interface UploadedFile {
  fieldName: string;
  fileName: string;
  mimeType: string;
  data?: Buffer;
  path?: string;
}

export interface MultipartResult {
  fields: Record<string, string>;
  files: Map<string, UploadedFile>;
  cleanup(): void;
}

/**
 * Reads a multipart request. File size limits are enforced by
 * @fastify/multipart while streaming, so oversized uploads are rejected
 * before they are fully read. With `toDisk`, files are streamed to a temp
 * directory that `cleanup()` always removes.
 */
export async function readMultipart(
  request: FastifyRequest,
  options: { fileFields: string[]; maxFileBytes: number; toDisk?: string },
): Promise<MultipartResult> {
  if (!request.isMultipart()) throw new HttpError(415, 'multipart_required', 'This endpoint expects multipart/form-data.');
  const fields: Record<string, string> = {};
  const files = new Map<string, UploadedFile>();
  let tempDir: string | null = null;
  const cleanup = () => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  };
  const tooLarge = () => new HttpError(413, 'file_too_large', `The uploaded file is larger than the ${formatMegabytes(options.maxFileBytes)} limit.`);
  try {
    const parts = request.parts({
      limits: { fileSize: options.maxFileBytes, files: options.fileFields.length, fields: 50, fieldSize: 1024 * 1024 },
    });
    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.valueTruncated) throw new HttpError(413, 'field_too_large', `The field ${part.fieldname} is too large.`);
        fields[part.fieldname] = String(part.value);
        continue;
      }
      if (!options.fileFields.includes(part.fieldname) || files.has(part.fieldname)) {
        part.file.resume();
        throw new HttpError(400, 'unexpected_file', `Unexpected file field ${part.fieldname}.`);
      }
      const file: UploadedFile = { fieldName: part.fieldname, fileName: part.filename, mimeType: part.mimetype };
      if (options.toDisk) {
        if (!tempDir) {
          tempDir = path.join(options.toDisk, `.upload-${randomUUID()}`);
          mkdirSync(tempDir, { recursive: true });
        }
        file.path = path.join(tempDir, `${randomUUID()}.bin`);
        try {
          await pipeline(part.file, createWriteStream(file.path));
        } catch (error) {
          if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge();
          throw error;
        }
        if (part.file.truncated) throw tooLarge();
      } else {
        try {
          file.data = await part.toBuffer();
        } catch (error) {
          if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge();
          throw error;
        }
        if (part.file.truncated) throw tooLarge();
        if (file.data.length === 0 && !part.filename) continue;
      }
      files.set(part.fieldname, file);
    }
  } catch (error) {
    cleanup();
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge();
    throw error;
  }
  return { fields, files, cleanup };
}

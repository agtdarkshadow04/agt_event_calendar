import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_IMAGE_BYTES } from './config';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

const EXTENSIONS: Record<ImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const EXTENSION_TYPES: Record<string, ImageMime> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  jfif: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export class ImageRejectedError extends Error {
  constructor(message: string, readonly statusCode = 415) {
    super(message);
  }
}

/** Detects the image type from the file's magic bytes. SVG and everything else return null. */
export function detectImageType(data: Uint8Array): ImageMime | null {
  const ascii = (start: number, end: number) => Buffer.from(data.subarray(start, end)).toString('latin1');
  if (
    data.length >= 24 &&
    data[0] === 0x89 && ascii(1, 4) === 'PNG' && data[4] === 0x0d && data[5] === 0x0a &&
    data[6] === 0x1a && data[7] === 0x0a && ascii(12, 16) === 'IHDR'
  ) {
    return 'image/png';
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.length >= 16 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' && ascii(12, 15) === 'VP8') {
    return 'image/webp';
  }
  if (data.length >= 13 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) {
    return 'image/gif';
  }
  return null;
}

/**
 * Checks an upload by its actual contents. The declared MIME type and file
 * extension are never trusted, but when they name a different type than the
 * contents the upload is rejected.
 */
export function validateImage(
  data: Uint8Array,
  options: { maxBytes?: number; declaredMime?: string | null; fileName?: string | null } = {},
): ImageMime {
  const maxBytes = Math.min(options.maxBytes ?? MAX_IMAGE_BYTES, MAX_IMAGE_BYTES);
  if (data.length === 0) throw new ImageRejectedError('The image file is empty.', 400);
  if (data.length > maxBytes) {
    throw new ImageRejectedError(`The image is larger than the ${formatMegabytes(maxBytes)} limit.`, 413);
  }
  const detected = detectImageType(data);
  if (!detected) {
    throw new ImageRejectedError('Only PNG, JPEG, WebP and GIF images are allowed (SVG is not supported). The file contents are not one of these formats.');
  }
  const declared = options.declaredMime?.toLowerCase().split(';')[0].trim();
  if (declared && declared !== 'application/octet-stream') {
    const normalized = declared === 'image/jpg' || declared === 'image/pjpeg' ? 'image/jpeg' : declared;
    if (normalized !== detected) {
      throw new ImageRejectedError(`The declared type ${declared} does not match the file contents (${detected}).`);
    }
  }
  const extension = options.fileName ? path.extname(options.fileName).slice(1).toLowerCase() : '';
  if (extension) {
    const fromExtension = EXTENSION_TYPES[extension];
    if (fromExtension !== detected) {
      throw new ImageRejectedError(`The file extension .${extension} does not match the file contents (${detected}).`);
    }
  }
  return detected;
}

export function formatMegabytes(bytes: number): string {
  return `${Number((bytes / 1024 / 1024).toFixed(1))} MB`;
}

export interface ImageRecord {
  id: string;
  fileName: string;
  mimeType: ImageMime;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  updatedAt: string;
}

/** Writes an already-validated image under a random server-generated name. */
export function writeImageFile(uploadsDir: string, data: Uint8Array, mimeType: ImageMime): ImageRecord {
  mkdirSync(uploadsDir, { recursive: true });
  const id = randomUUID();
  const fileName = `${id}.${EXTENSIONS[mimeType]}`;
  const temporary = path.join(uploadsDir, `.${fileName}.tmp`);
  writeFileSync(temporary, data, { flag: 'wx' });
  renameSync(temporary, path.join(uploadsDir, fileName));
  const timestamp = new Date().toISOString();
  return {
    id,
    fileName,
    mimeType,
    sizeBytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function removeImageFile(uploadsDir: string, fileName: string): void {
  if (!/^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/.test(fileName)) return;
  rmSync(path.join(uploadsDir, fileName), { force: true });
}

export const STORED_IMAGE_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(png|jpg|webp|gif)$/;
export const MIME_BY_EXTENSION: Record<string, ImageMime> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

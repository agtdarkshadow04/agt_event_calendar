import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import yazl from 'yazl';

export class ZipRejectedError extends Error {
  readonly statusCode = 422;
}

export interface ZipLimits {
  maxEntries: number;
  maxUncompressedBytes: number;
}

export interface SafeZipEntry {
  /** Normalised path with forward slashes, no leading slash; directories end with `/`. */
  name: string;
  isDirectory: boolean;
  size: number;
  entry: Entry;
}

export interface SafeZip {
  entries: SafeZipEntry[];
  read(entry: SafeZipEntry, maxBytes?: number): Promise<Buffer>;
  close(): void;
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

function checkName(rawName: string): string {
  const name = rawName.replaceAll('\\', '/');
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
    throw new ZipRejectedError(`The ZIP contains an absolute path (${rawName}), which is not allowed.`);
  }
  if (name.split('/').some((segment) => segment === '..')) {
    throw new ZipRejectedError(`The ZIP contains a path with ".." (${rawName}), which is not allowed.`);
  }
  if (name.includes('\0')) throw new ZipRejectedError('The ZIP contains an invalid file name.');
  return name;
}

function isSymlink(entry: Entry): boolean {
  const madeBy = entry.versionMadeBy >> 8;
  const unixMode = (entry.externalFileAttributes >>> 16) & S_IFMT;
  return (madeBy === 3 || madeBy === 19 || unixMode !== 0) && unixMode === S_IFLNK;
}

/**
 * Opens a ZIP file and validates its central directory before anything is
 * extracted: entry count, total uncompressed size, absolute paths, `..`
 * segments and symlinks are all rejected. Entries are read into memory one at
 * a time; nothing is written to disk.
 */
export async function openSafeZip(filePath: string, limits: ZipLimits): Promise<SafeZip> {
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: false }, (error, file) => {
      if (error || !file) reject(new ZipRejectedError(`The file is not a valid ZIP archive: ${error?.message ?? 'unknown error'}`));
      else resolve(file);
    });
  });
  try {
    if (zip.entryCount > limits.maxEntries) {
      throw new ZipRejectedError(`The ZIP has ${zip.entryCount} entries; the limit is ${limits.maxEntries}.`);
    }
    const entries: SafeZipEntry[] = [];
    let total = 0;
    await new Promise<void>((resolve, reject) => {
      zip.on('entry', (entry: Entry) => {
        try {
          const name = checkName(entry.fileName);
          if (isSymlink(entry)) throw new ZipRejectedError(`The ZIP contains a symbolic link (${entry.fileName}), which is not allowed.`);
          total += entry.uncompressedSize;
          if (total > limits.maxUncompressedBytes) {
            throw new ZipRejectedError(`The ZIP expands to more than ${limits.maxUncompressedBytes} bytes, which exceeds the limit.`);
          }
          entries.push({ name, isDirectory: name.endsWith('/'), size: entry.uncompressedSize, entry });
          zip.readEntry();
        } catch (error) {
          reject(error);
        }
      });
      zip.on('end', () => resolve());
      zip.on('error', (error: Error) => reject(
        error instanceof ZipRejectedError ? error : new ZipRejectedError(`The ZIP archive is invalid: ${error.message}`),
      ));
      zip.readEntry();
    });

    return {
      entries,
      close: () => zip.close(),
      read: (item, maxBytes = Number.POSITIVE_INFINITY) => new Promise<Buffer>((resolve, reject) => {
        if (item.size > maxBytes) {
          reject(new ZipRejectedError(`${item.name} is larger than the allowed ${maxBytes} bytes.`));
          return;
        }
        zip.openReadStream(item.entry, (error, stream) => {
          if (error || !stream) {
            reject(new ZipRejectedError(`Unable to read ${item.name}: ${error?.message ?? 'unknown error'}`));
            return;
          }
          const chunks: Buffer[] = [];
          let received = 0;
          stream.on('data', (chunk: Buffer) => {
            received += chunk.length;
            if (received > maxBytes) {
              stream.destroy(new ZipRejectedError(`${item.name} is larger than the allowed ${maxBytes} bytes.`));
              return;
            }
            chunks.push(chunk);
          });
          stream.on('error', (streamError: Error) => reject(
            streamError instanceof ZipRejectedError ? streamError : new ZipRejectedError(`Unable to read ${item.name}: ${streamError.message}`),
          ));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
        });
      }),
    };
  } catch (error) {
    zip.close();
    throw error;
  }
}

/** Writes a ZIP archive from in-memory buffers or files on disk. */
export async function writeZip(
  outputPath: string,
  files: { name: string; data?: Buffer | string; path?: string }[],
): Promise<void> {
  const zip = new yazl.ZipFile();
  for (const file of files) {
    if (file.path) zip.addFile(file.path, file.name);
    else zip.addBuffer(Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data ?? ''), file.name);
  }
  zip.end();
  await pipeline(zip.outputStream as Readable, createWriteStream(outputPath));
}

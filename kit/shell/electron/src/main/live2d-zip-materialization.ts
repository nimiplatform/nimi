import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import {
  MAX_AVATAR_ASSET_BYTES,
  MAX_AVATAR_ASSET_FILE_BYTES,
  MAX_AVATAR_ASSET_FILE_COUNT,
  invalidAsset,
  invalidPath,
} from './agent-center-contract.js';
import { isSameOrChildPath } from './paths.js';

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const MAX_ZIP_COMMENT_BYTES = 65_535;
const WIN32_INVALID_PATH_SEGMENT_CHARACTERS = /[\u0000-\u001f\u007f<>:"\\|?*]/u;
const WIN32_RESERVED_DEVICE_STEM = /^(?:aux|clock\$|com[1-9¹²³]|con|conin\$|conout\$|lpt[1-9¹²³]|nul|prn)$/iu;

type CentralEntry = {
  readonly name: string;
  readonly relativePath: string;
  readonly isDirectory: boolean;
  readonly flags: number;
  readonly method: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
};

export type MaterializedLive2dZip = {
  readonly entryRelativePath: string;
  readonly fileRelativePaths: readonly string[];
};

export async function materializeLive2dZip(
  content: Uint8Array,
  destinationRoot: string,
  command: string,
): Promise<MaterializedLive2dZip> {
  const bytes = Buffer.from(content);
  const entries = readCentralEntries(bytes, command);
  const files = entries.filter((entry) => !entry.isDirectory);
  if (files.length === 0 || files.length > MAX_AVATAR_ASSET_FILE_COUNT) {
    throw invalidAsset(command, 'Runtime Live2D ZIP file count is outside the admitted bounds.');
  }
  assertNoPathCollisions(entries, command);

  const modelEntries = files.filter((entry) => entry.relativePath.endsWith('.model3.json'));
  if (modelEntries.length !== 1) {
    throw invalidAsset(command, 'Runtime Live2D ZIP must contain exactly one .model3.json file.');
  }

  let totalBytes = 0;
  for (const entry of files) {
    if (entry.uncompressedSize <= 0 || entry.uncompressedSize > MAX_AVATAR_ASSET_FILE_BYTES) {
      throw invalidAsset(command, 'Runtime Live2D ZIP entry is outside the admitted byte cap.');
    }
    totalBytes += entry.uncompressedSize;
    if (totalBytes > MAX_AVATAR_ASSET_BYTES) {
      throw invalidAsset(command, 'Runtime Live2D ZIP expands beyond the admitted total byte cap.');
    }
    const output = inflateEntry(bytes, entry, command);
    const target = path.join(destinationRoot, ...entry.relativePath.split('/'));
    if (!isSameOrChildPath(destinationRoot, target) || target === destinationRoot) {
      throw invalidPath(command, 'Runtime Live2D ZIP entry escaped the materialization root.');
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, output, { flag: 'wx' });
  }

  return {
    entryRelativePath: modelEntries[0]!.relativePath,
    fileRelativePaths: files.map((entry) => entry.relativePath),
  };
}

function readCentralEntries(bytes: Buffer, command: string): CentralEntry[] {
  const eocdOffset = findEndOfCentralDirectory(bytes, command);
  const diskNumber = readU16(bytes, eocdOffset + 4, command);
  const centralDisk = readU16(bytes, eocdOffset + 6, command);
  const diskEntries = readU16(bytes, eocdOffset + 8, command);
  const totalEntries = readU16(bytes, eocdOffset + 10, command);
  const centralSize = readU32(bytes, eocdOffset + 12, command);
  const centralOffset = readU32(bytes, eocdOffset + 16, command);
  const commentLength = readU16(bytes, eocdOffset + 20, command);
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries
    || totalEntries === 0 || totalEntries > MAX_AVATAR_ASSET_FILE_COUNT
    || totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw invalidAsset(command, 'Runtime Live2D ZIP uses an unsupported multi-disk or ZIP64 layout.');
  }
  if (eocdOffset + 22 + commentLength !== bytes.byteLength
    || centralOffset + centralSize !== eocdOffset) {
    throw invalidAsset(command, 'Runtime Live2D ZIP central directory bounds are invalid.');
  }

  const entries: CentralEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (readU32(bytes, offset, command) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw invalidAsset(command, 'Runtime Live2D ZIP central directory entry is invalid.');
    }
    const flags = readU16(bytes, offset + 8, command);
    const method = readU16(bytes, offset + 10, command);
    const crc = readU32(bytes, offset + 16, command);
    const compressedSize = readU32(bytes, offset + 20, command);
    const uncompressedSize = readU32(bytes, offset + 24, command);
    const nameLength = readU16(bytes, offset + 28, command);
    const extraLength = readU16(bytes, offset + 30, command);
    const entryCommentLength = readU16(bytes, offset + 32, command);
    const diskStart = readU16(bytes, offset + 34, command);
    const externalAttributes = readU32(bytes, offset + 38, command);
    const localHeaderOffset = readU32(bytes, offset + 42, command);
    const entryEnd = offset + 46 + nameLength + extraLength + entryCommentLength;
    assertRange(bytes, offset, entryEnd - offset, command);
    if ((flags & 0x0001) !== 0 || (method !== 0 && method !== 8)
      || diskStart !== 0 || compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw invalidAsset(command, 'Runtime Live2D ZIP entry uses unsupported encryption, compression, or ZIP64 fields.');
    }
    const unixFileType = (externalAttributes >>> 16) & 0xf000;
    if (unixFileType === 0xa000) {
      throw invalidPath(command, 'Runtime Live2D ZIP must not contain symbolic links.');
    }
    const name = decodeName(bytes.subarray(offset + 46, offset + 46 + nameLength), command);
    const isDirectory = name.endsWith('/');
    const relativePath = safeRelativePath(name, isDirectory, command);
    entries.push({
      name,
      relativePath,
      isDirectory,
      flags,
      method,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset = entryEnd;
  }
  if (offset !== eocdOffset) {
    throw invalidAsset(command, 'Runtime Live2D ZIP central directory length is inconsistent.');
  }
  return entries;
}

function inflateEntry(bytes: Buffer, entry: CentralEntry, command: string): Buffer {
  const offset = entry.localHeaderOffset;
  if (readU32(bytes, offset, command) !== LOCAL_FILE_SIGNATURE) {
    throw invalidAsset(command, 'Runtime Live2D ZIP local entry header is invalid.');
  }
  const localFlags = readU16(bytes, offset + 6, command);
  const localMethod = readU16(bytes, offset + 8, command);
  const nameLength = readU16(bytes, offset + 26, command);
  const extraLength = readU16(bytes, offset + 28, command);
  const dataOffset = offset + 30 + nameLength + extraLength;
  assertRange(bytes, offset + 30, nameLength + extraLength, command);
  const localName = decodeName(bytes.subarray(offset + 30, offset + 30 + nameLength), command);
  if (localName !== entry.name || localFlags !== entry.flags || localMethod !== entry.method) {
    throw invalidAsset(command, 'Runtime Live2D ZIP local and central entry metadata disagree.');
  }
  assertRange(bytes, dataOffset, entry.compressedSize, command);
  const compressed = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
  let output: Buffer;
  try {
    output = entry.method === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize });
  } catch {
    throw invalidAsset(command, 'Runtime Live2D ZIP entry decompression failed.');
  }
  if (output.byteLength !== entry.uncompressedSize || crc32(output) !== entry.crc32) {
    throw invalidAsset(command, 'Runtime Live2D ZIP entry length or CRC is invalid.');
  }
  return output;
}

function findEndOfCentralDirectory(bytes: Buffer, command: string): number {
  const start = Math.max(0, bytes.byteLength - 22 - MAX_ZIP_COMMENT_BYTES);
  for (let offset = bytes.byteLength - 22; offset >= start; offset -= 1) {
    if (bytes.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  throw invalidAsset(command, 'Runtime Live2D material is not a complete ZIP archive.');
}

function safeRelativePath(name: string, isDirectory: boolean, command: string): string {
  const withoutSlash = isDirectory ? name.slice(0, -1) : name;
  if (!withoutSlash || name.length > 1_024 || name.includes('\\') || name.includes('\0')
    || path.posix.isAbsolute(name) || path.win32.isAbsolute(name)) {
    throw invalidPath(command, 'Runtime Live2D ZIP entry path is unsafe.');
  }
  const segments = withoutSlash.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')
    || segments.some((segment) => !isSafeWin32PathSegment(segment))
    || segments.join('/') !== withoutSlash) {
    throw invalidPath(command, 'Runtime Live2D ZIP entry path is unsafe.');
  }
  return withoutSlash;
}

function isSafeWin32PathSegment(segment: string): boolean {
  if (WIN32_INVALID_PATH_SEGMENT_CHARACTERS.test(segment) || /[ .]$/u.test(segment)) {
    return false;
  }
  const deviceStem = segment.split('.', 1)[0]!.replace(/[ .]+$/u, '');
  return !WIN32_RESERVED_DEVICE_STEM.test(deviceStem);
}

function assertNoPathCollisions(entries: readonly CentralEntry[], command: string): void {
  const paths = new Map<string, 'file' | 'directory'>();
  for (const entry of entries) {
    const key = entry.relativePath.toLocaleLowerCase('en-US');
    if (paths.has(key)) {
      throw invalidPath(command, 'Runtime Live2D ZIP contains duplicate materialization paths.');
    }
    const segments = key.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      if (paths.get(segments.slice(0, index).join('/')) === 'file') {
        throw invalidPath(command, 'Runtime Live2D ZIP file and directory paths collide.');
      }
    }
    if (!entry.isDirectory && [...paths.keys()].some((candidate) => candidate.startsWith(`${key}/`))) {
      throw invalidPath(command, 'Runtime Live2D ZIP file and directory paths collide.');
    }
    paths.set(key, entry.isDirectory ? 'directory' : 'file');
  }
}

function decodeName(bytes: Uint8Array, command: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw invalidPath(command, 'Runtime Live2D ZIP entry names must be UTF-8.');
  }
}

function readU16(bytes: Buffer, offset: number, command: string): number {
  assertRange(bytes, offset, 2, command);
  return bytes.readUInt16LE(offset);
}

function readU32(bytes: Buffer, offset: number, command: string): number {
  assertRange(bytes, offset, 4, command);
  return bytes.readUInt32LE(offset);
}

function assertRange(bytes: Buffer, offset: number, length: number, command: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
    || offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw invalidAsset(command, 'Runtime Live2D ZIP structure is truncated.');
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

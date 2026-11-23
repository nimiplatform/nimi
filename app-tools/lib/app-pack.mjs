import { assertDesktopHostSupport } from './app-host-support.mjs';
import { validateManifestDesktop } from './desktop-window.mjs';
import { isAppId } from './app-identifiers.mjs';
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-009b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-018a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-024a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-024b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-043a

import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  existsSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  writeSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import {
  crc32 as nativeCrc32,
  createDeflateRaw,
  createInflateRaw,
  deflateRawSync,
  inflateRawSync,
} from 'node:zlib';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { APP_INFO_DECLARATION_FIELDS, APP_INFO_MAX_BYTES, readAppInfo, readAppStorefront, validateAppInfo } from './app-info.mjs';
import { STOREFRONT_ARCHIVE_MAX_BYTES } from './storefront-media.mjs';
import { observeWindowsExecutableFacts } from './windows-powershell.mjs';
import { MAX_SYMLINK_TARGET_BYTES, SYMBOLIC_LINK_MODE, validatePayloadLinks } from './payload-links.mjs';
import { observeMacOSExecutableFacts } from './macos-native.mjs';

const PACKAGE_FORMAT = 'nimi.app-package/v2';
const TARGET_METADATA_FORMAT = 'nimi.app-target-candidate/v1';
const AGGREGATE_FORMAT = 'nimi.app-release-candidate/v1';
const BUILD_PROFILE_PATH = '.nimi/config/build-profile.yaml';
const MANAGED_WEB_BUILD_PROFILE_REF = 'managed-web-pnpm-vite';
const MANAGED_WEB_EXECUTION_PROFILE_REF = 'nimi-managed-web-v1';
const MANAGED_WEB_RUNTIME_ENTRY = 'payload/index.html';
export const NATIVE_MAX_ARCHIVE_BYTES = 2000 * 1024 * 1024;
export const NATIVE_MAX_ENTRY_BYTES = 2000 * 1024 * 1024;
export const NATIVE_MAX_RELEASE_BYTES = 4 * 1024 * 1024 * 1024;
export const NATIVE_MAX_DIRECTORIES = 65_535;
export const MANAGED_WEB_MAX_ARCHIVE_BYTES = 72 * 1024 * 1024;
export const MANAGED_WEB_MAX_RELEASE_BYTES = 64 * 1024 * 1024;
export const MANAGED_WEB_MAX_RELEASE_ENTRIES = 10_000;
export const MAX_ARCHIVE_DIRECTORY_DEPTH = 64;
export const MAX_ARCHIVE_ENTRY_NAME_BYTES = 1024;
export const MAX_ZIP32_ENTRIES = 65_535;
export const MAX_LICENSE_BYTES = 128 * 1024;
export const MAX_CONTROL_DOCUMENT_BYTES = 1024 * 1024;
export const EXPANSION_RATIO_FLOOR_BYTES = 8 * 1024 * 1024;
export const MAX_EXPANSION_RATIO = 20;
const STREAM_DEFLATE_THRESHOLD = 32 * 1024 * 1024;
const STREAM_IO_CHUNK_BYTES = 256 * 1024;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
const ZIP_FLAGS_UTF8 = 0x0800;
const ZIP_CREATOR_UNIX = 0x0314;
const ZIP_READER_VERSION = 20;
const ZIP_MOD_TIME = 0;
const ZIP_MOD_DATE = 0x0021;
const EXT_ATTR_REGULAR_0644 = 0x81A40000;
const EXT_ATTR_REGULAR_0755 = 0x81ED0000;
const EXT_ATTR_SYMLINK_0777 = 0xA1FF0000;
const DEFLATE_LEVEL = 6;
const ELECTRON_BUILD_PROFILE_REF = 'electron-packager-pnpm-vite';
const APP_OWNED_ELECTRON_BUILD_PROFILE_REF = 'electron-pnpm';
const OUTPUT_DIR = 'dist/nimi-app';
const SEMVER_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const TARGETS = Object.freeze({
  'windows-x86_64': Object.freeze({ os: 'windows', arch: 'x86_64' }),
  'macos-aarch64': Object.freeze({ os: 'macos', arch: 'arm64' }),
  'desktop-universal': Object.freeze({ os: 'any', arch: 'any' }),
});
const WINDOWS_RESERVED_BASES = new Set(['CON', 'PRN', 'AUX', 'NUL', 'CLOCK$', 'CONIN$', 'CONOUT$']);
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const NIMIAPP_CONTROL_LIMITS = new Map([
  ['LICENSE', MAX_LICENSE_BYTES],
  ['app-info.json', APP_INFO_MAX_BYTES],
  ['manifest.json', MAX_CONTROL_DOCUMENT_BYTES],
  ['nimi.app.yaml', MAX_CONTROL_DOCUMENT_BYTES],
]);

function validWindowsSegment(segment) {
  if (/[<>:"|?*]/u.test(segment) || segment.endsWith('.') || segment.endsWith(' ')) {
    return false;
  }
  const base = segment.split('.', 1)[0].replace(/ +$/u, '').toUpperCase();
  if (WINDOWS_RESERVED_BASES.has(base)) return false;
  if (/^(?:COM|LPT)(?:[1-9]|¹|²|³)$/u.test(base)) return false;
  return true;
}

function unicodeCaseFold(input) {
  let out = '';
  for (const ch of input.normalize('NFC')) {
    const cp = ch.codePointAt(0);
    if (cp === 0x0131) out += '\u0131';
    else if (cp === 0x1e9e) out += 'ss';
    else if (cp >= 0x13f8 && cp <= 0x13fd) out += String.fromCodePoint(cp - 8);
    else if (cp >= 0xab70 && cp <= 0xabbf) out += String.fromCodePoint(cp - 0x97d0);
    else out += ch.toUpperCase().toLowerCase();
  }
  return out;
}

function targetPathCollisionKey(name, targetOS) {
  const normalized = name.normalize('NFC');
  if (targetOS === 'windows' || targetOS === 'any') {
    return unicodeCaseFold(normalized);
  }
  return normalized;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function decodeStrictUtf8(buf, label) {
  if (!Buffer.isBuffer(buf) || !isUtf8(buf)) {
    throw new Error(`Invalid ${label}: malformed UTF-8`);
  }
  try {
    return UTF8_DECODER.decode(buf);
  } catch {
    throw new Error(`Invalid ${label}: malformed UTF-8`);
  }
}

function parseCanonicalExternalAttrs(externalAttrs) {
  if (externalAttrs === EXT_ATTR_REGULAR_0644) return 0o644;
  if (externalAttrs === EXT_ATTR_REGULAR_0755) return 0o755;
  if (externalAttrs === EXT_ATTR_SYMLINK_0777) return SYMBOLIC_LINK_MODE;
  throw new Error(`Invalid nimiapp ZIP entry mode attributes: 0x${externalAttrs.toString(16)}`);
}

function encodeCanonicalExternalAttrs(mode) {
  if (mode === SYMBOLIC_LINK_MODE) return EXT_ATTR_SYMLINK_0777;
  if (mode === 0o755) return EXT_ATTR_REGULAR_0755;
  if (mode === 0o644) return EXT_ATTR_REGULAR_0644;
  throw new Error(`Unsupported nimiapp ZIP entry mode: ${String(mode)}`);
}

function validateCrossPlatformArchiveEntries(entries, targetOS) {
  const roles = new Map();
  let fileCount = 0;
  for (const entry of entries) {
    const name = entry.name;
    const segments = name.split('/');
    if (segments.length - 1 > MAX_ARCHIVE_DIRECTORY_DEPTH) {
      throw new Error(`Archive directory depth exceeds ${MAX_ARCHIVE_DIRECTORY_DEPTH}: ${name}`);
    }
    for (const segment of segments) {
      for (const ch of segment) {
        const code = ch.codePointAt(0);
        if (code < 0x20 || code === 0x7f) {
          throw new Error(`Archive entry path contains control character: ${name}`);
        }
      }
      if ((targetOS === 'windows' || targetOS === 'any') && !validWindowsSegment(segment)) {
        throw new Error(`Archive entry path uses invalid Windows segment: ${name}`);
      }
    }
    for (let index = 0; index < segments.length; index += 1) {
      const prefix = segments.slice(0, index + 1).join('/');
      const key = targetPathCollisionKey(prefix, targetOS);
      const isFile = index === segments.length - 1;
      const previous = roles.get(key);
      if (previous) {
        if (previous.spelling !== prefix || previous.file || isFile) {
          throw new Error(`Archive entry path collision on ${targetOS}: ${previous.spelling} and ${prefix}`);
        }
      } else {
        roles.set(key, { spelling: prefix, file: isFile });
      }
    }
    fileCount += 1;
    const dirCount = roles.size - fileCount;
    if (targetOS === 'any' && dirCount > MANAGED_WEB_MAX_RELEASE_ENTRIES) {
      throw new Error(`Managed-web package exceeds ${MANAGED_WEB_MAX_RELEASE_ENTRIES} directories`);
    }
    if (targetOS !== 'any' && dirCount > NATIVE_MAX_DIRECTORIES) {
      throw new Error(`Native package exceeds ${NATIVE_MAX_DIRECTORIES} directories`);
    }
  }
}

function pathsOverlapOrEqual(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  const cmpA = process.platform === 'win32' ? a.toLowerCase() : a;
  const cmpB = process.platform === 'win32' ? b.toLowerCase() : b;
  return cmpA === cmpB
    || cmpA.startsWith(`${cmpB}${path.sep}`)
    || cmpB.startsWith(`${cmpA}${path.sep}`);
}

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedValue(value[key])]));
}

function canonicalJson(value) {
  return `${JSON.stringify(sortedValue(value), null, 2)}\n`;
}

export function hashAppArchive(bytes) {
  const hash = createHash('sha256');
  // Node's native crypto update accepts at most an int32-sized input even
  // though a valid ZIP32 App archive can exceed 2 GiB.
  const chunkBytes = 64 * 1024 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    hash.update(bytes.subarray(offset, offset + chunkBytes));
  }
  return hash.digest('hex');
}

export async function hashFileHandle(handle, expectedSize) {
  const hash = createHash('sha256');
  const buf = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, expectedSize)));
  let pos = 0;
  while (pos < expectedSize) {
    const toRead = Math.min(buf.length, expectedSize - pos);
    const { bytesRead } = await handle.read(buf, 0, toRead, pos);
    if (bytesRead <= 0) throw new Error('App archive ended before its recorded size');
    hash.update(buf.subarray(0, bytesRead));
    pos += bytesRead;
  }
  return hash.digest('hex');
}

async function hashFilePath(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`Expected regular file: ${filePath}`);
    return await hashFileHandle(handle, stat.size);
  } finally {
    await handle.close();
  }
}

export function writeAppArchiveFile(filePath, bytes) {
  const fd = openSync(filePath, 'w');
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, Math.min(64 * 1024 * 1024, bytes.length - offset));
      if (written <= 0) throw new Error('App archive write did not make progress');
      offset += written;
    }
  } finally { closeSync(fd); }
}

export function readAppArchiveFile(filePath) {
  const fd = openSync(filePath, 'r');
  try {
    const bytes = Buffer.allocUnsafe(fstatSync(fd).size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(fd, bytes, offset, Math.min(64 * 1024 * 1024, bytes.length - offset), null);
      if (read <= 0) throw new Error('App archive ended before its recorded size');
      offset += read;
    }
    return bytes;
  } finally { closeSync(fd); }
}

function sameCanonicalValue(left, right) {
  return JSON.stringify(sortedValue(left)) === JSON.stringify(sortedValue(right));
}

function canonicalRelative(value, field) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.includes('\\') || value.includes('\0')) {
    throw new Error(`Invalid ${field}: must be a canonical relative path`);
  }
  const parts = value.split('/');
  if (value.startsWith('/') || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid ${field}: must be a canonical relative path`);
  }
  return value;
}

function resolveInside(root, relative, field) {
  const normalized = canonicalRelative(relative, field);
  const resolved = path.resolve(root, ...normalized.split('/'));
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!resolved.startsWith(prefix)) throw new Error(`${field} escapes the App repository`);
  return { normalized, resolved };
}

function readJson(filePath, label) {
  try {
    const value = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('root must be an object');
    return value;
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readYaml(filePath, label) {
  if (!existsSync(filePath)) throw new Error(`${label} is missing: ${filePath}`);
  try {
    const value = parseYaml(readFileSync(filePath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('root must be an object');
    return value;
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function collectPayload(payloadPath, os) {
  const stat = lstatSync(payloadPath);
  if (stat.isSymbolicLink()) throw new Error('Pack payload must not contain symbolic links');
  if (stat.isFile()) {
    return [{ relative: path.basename(payloadPath), filePath: payloadPath, size: stat.size, mode: stat.mode & 0o111 ? 0o755 : 0o644 }];
  }
  if (!stat.isDirectory()) throw new Error('Pack payload must be a regular file or directory');
  const entries = [];
  const walk = (current, prefix = '') => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => compareUtf8(left.name, right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      const entryStat = lstatSync(absolute);
      if (entryStat.isSymbolicLink()) {
        if (os !== 'macos') throw new Error(`Pack payload must not contain symbolic links: ${relative}`);
        const linkBytes = Buffer.from(readlinkSync(absolute), 'utf8');
        entries.push({ relative, bytes: linkBytes, size: linkBytes.length, mode: SYMBOLIC_LINK_MODE });
      } else if (entryStat.isDirectory()) {
        walk(absolute, relative);
      } else if (entryStat.isFile()) {
        entries.push({ relative, filePath: absolute, size: entryStat.size, mode: entryStat.mode & 0o111 ? 0o755 : 0o644 });
      } else {
        throw new Error(`Unsupported pack payload entry: ${relative}`);
      }
    }
  };
  walk(payloadPath);
  if (entries.length === 0) throw new Error('Pack payload must not be empty');
  return entries;
}

function zipEntryName(value) {
  const name = canonicalRelative(value, 'archive entry');
  if (Buffer.byteLength(name, 'utf8') > MAX_ARCHIVE_ENTRY_NAME_BYTES) {
    throw new Error(`Invalid archive entry path length (exceeds ${MAX_ARCHIVE_ENTRY_NAME_BYTES} bytes): ${name}`);
  }
  if (name.split('/').length - 1 > MAX_ARCHIVE_DIRECTORY_DEPTH) {
    throw new Error(`Invalid archive directory depth exceeds ${MAX_ARCHIVE_DIRECTORY_DEPTH}: ${name}`);
  }
  for (const ch of name) {
    const code = ch.codePointAt(0);
    if (code < 0x20 || code === 0x7f) {
      throw new Error(`Invalid archive entry path control character: ${name}`);
    }
  }
  return name;
}

function buildLocalHeaderBuffer(rawName, method, crc, compSize, uncompSize) {
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(ZIP_READER_VERSION, 4);
  local.writeUInt16LE(ZIP_FLAGS_UTF8, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(ZIP_MOD_TIME, 10);
  local.writeUInt16LE(ZIP_MOD_DATE, 12);
  local.writeUInt32LE(crc >>> 0, 14);
  local.writeUInt32LE(compSize >>> 0, 18);
  local.writeUInt32LE(uncompSize >>> 0, 22);
  local.writeUInt16LE(rawName.length, 26);
  local.writeUInt16LE(0, 28);
  return local;
}

function buildCentralHeaderBuffer(rawName, method, crc, compSize, uncompSize, externalAttrs, localOffset) {
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(ZIP_CREATOR_UNIX, 4);
  central.writeUInt16LE(ZIP_READER_VERSION, 6);
  central.writeUInt16LE(ZIP_FLAGS_UTF8, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(ZIP_MOD_TIME, 12);
  central.writeUInt16LE(ZIP_MOD_DATE, 14);
  central.writeUInt32LE(crc >>> 0, 16);
  central.writeUInt32LE(compSize >>> 0, 20);
  central.writeUInt32LE(uncompSize >>> 0, 24);
  central.writeUInt16LE(rawName.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(externalAttrs >>> 0, 38);
  central.writeUInt32LE(localOffset >>> 0, 42);
  return central;
}

function buildEocdBuffer(entryCount, centralSize, centralOffset) {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralSize >>> 0, 12);
  end.writeUInt32LE(centralOffset >>> 0, 16);
  end.writeUInt16LE(0, 20);
  return end;
}

function validateNimiappLayoutEntry(name, mode, uncompressedSize) {
  const controlLimit = NIMIAPP_CONTROL_LIMITS.get(name);
  if (controlLimit !== undefined) {
    if (mode !== 0o644 || uncompressedSize <= 0 || uncompressedSize > controlLimit) {
      throw new Error(`Invalid nimiapp control entry ${name}`);
    }
    return;
  }
  if (!name.startsWith('payload/')) {
    throw new Error(`Invalid unexpected nimiapp root entry: ${name}`);
  }
}

export function writeNimiAppArchive(entries, options = {}) {
  const compress = options.compress !== false;
  const maxArchiveBytes = options.maxArchiveBytes ?? NATIVE_MAX_ARCHIVE_BYTES;
  const maxTotalUncompressedBytes = options.maxTotalUncompressedBytes ?? NATIVE_MAX_RELEASE_BYTES;
  const normalized = entries.map((entry) => {
    const name = zipEntryName(entry.name);
    const rawName = Buffer.from(name, 'utf8');
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes);
    const mode = entry.mode === SYMBOLIC_LINK_MODE ? SYMBOLIC_LINK_MODE : entry.mode === 0o755 ? 0o755 : 0o644;
    return { name, rawName, bytes, mode };
  }).sort((left, right) => Buffer.compare(left.rawName, right.rawName));
  if (normalized.length === 0 || normalized.length > MAX_ZIP32_ENTRIES) {
    throw new Error('nimiapp archive requires between 1 and 65535 files');
  }
  let totalUncompressed = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const entry = normalized[index];
    if (index > 0 && Buffer.compare(normalized[index - 1].rawName, entry.rawName) >= 0) {
      throw new Error('nimiapp archive entries must be unique');
    }
    const uncompSize = entry.bytes.length;
    if (uncompSize > NATIVE_MAX_ENTRY_BYTES || uncompSize >= 0xffffffff) {
      throw new Error(`Archive entry is too large: ${entry.name}`);
    }
    if (entry.mode === SYMBOLIC_LINK_MODE && (uncompSize === 0 || uncompSize > MAX_SYMLINK_TARGET_BYTES)) {
      throw new Error(`Invalid symbolic link target size: ${entry.name}`);
    }
    totalUncompressed += uncompSize;
    if (totalUncompressed > maxTotalUncompressedBytes) {
      throw new Error(`Archive uncompressed size exceeds ${maxTotalUncompressedBytes} bytes`);
    }
  }
  const enforceExpansionBudget = totalUncompressed > EXPANSION_RATIO_FLOOR_BYTES;

  const localParts = [];
  const centralParts = [];
  let offset = 0;
  let emittedUncompressed = 0;
  for (const entry of normalized) {
    const uncompSize = entry.bytes.length;
    const crc = uncompSize === 0 ? 0 : nativeCrc32(entry.bytes);
    let method = ZIP_METHOD_STORE;
    let payload = entry.bytes;
    if (compress && entry.mode !== SYMBOLIC_LINK_MODE && uncompSize > 0) {
      const deflated = deflateRawSync(entry.bytes, { level: DEFLATE_LEVEL });
      const fitsBudget = !enforceExpansionBudget
        || emittedUncompressed + uncompSize <= (offset + 30 + entry.rawName.length + deflated.length) * MAX_EXPANSION_RATIO;
      if (deflated.length > 0 && deflated.length < uncompSize && fitsBudget) {
        method = ZIP_METHOD_DEFLATE;
        payload = deflated;
      }
    }
    const compSize = payload.length;
    const nextOffset = offset + 30 + entry.rawName.length + compSize;
    if (nextOffset > maxArchiveBytes || nextOffset >= 0xffffffff) {
      throw new Error(`Archive exceeds maximum size budget (${maxArchiveBytes} bytes)`);
    }
    const local = buildLocalHeaderBuffer(entry.rawName, method, crc, compSize, uncompSize);
    localParts.push(local, entry.rawName, payload);
    const central = buildCentralHeaderBuffer(
      entry.rawName,
      method,
      crc,
      compSize,
      uncompSize,
      encodeCanonicalExternalAttrs(entry.mode),
      offset,
    );
    centralParts.push(central, entry.rawName);
    offset = nextOffset;
    emittedUncompressed += uncompSize;
  }
  const central = Buffer.concat(centralParts);
  const finalSize = offset + central.length + 22;
  if (finalSize > maxArchiveBytes || finalSize >= 0xffffffff) {
    throw new Error(`Archive exceeds maximum size budget (${maxArchiveBytes} bytes)`);
  }
  if (totalUncompressed > EXPANSION_RATIO_FLOOR_BYTES && totalUncompressed > finalSize * MAX_EXPANSION_RATIO) {
    throw new Error(`Archive expansion ratio exceeds ${MAX_EXPANSION_RATIO}x (${totalUncompressed} / ${finalSize})`);
  }
  const end = buildEocdBuffer(normalized.length, central.length, offset);
  return Buffer.concat([...localParts, central, end]);
}

async function writeFullBuffer(handle, buf, hash) {
  let off = 0;
  while (off < buf.length) {
    const { bytesWritten } = await handle.write(buf, off, buf.length - off);
    if (bytesWritten <= 0) throw new Error('App archive write did not make progress');
    off += bytesWritten;
  }
  if (hash && buf.length > 0) hash.update(buf);
}

async function readExactFromHandle(handle, buf, position) {
  let off = 0;
  while (off < buf.length) {
    const { bytesRead } = await handle.read(buf, off, buf.length - off, position + off);
    if (bytesRead <= 0) throw new Error('Invalid nimiapp ZIP: unexpected end of archive');
    off += bytesRead;
  }
  return buf;
}

async function streamDeflateFileToShard(sourcePath, shardPath, expectedSize, computeSha) {
  const srcHandle = await fsp.open(sourcePath, 'r');
  const shardHandle = await fsp.open(shardPath, 'w');
  const def = createDeflateRaw({ level: DEFLATE_LEVEL });
  let crc = 0;
  let plainLen = 0;
  let compSize = 0;
  const entrySha = computeSha ? createHash('sha256') : null;
  let writeChain = Promise.resolve();
  let streamErr = null;
  const done = new Promise((resolve, reject) => {
    def.on('data', (chunk) => {
      compSize += chunk.length;
      const copy = Buffer.from(chunk);
      writeChain = writeChain.then(() => writeFullBuffer(shardHandle, copy, null));
      writeChain.catch((e) => {
        if (!streamErr) {
          streamErr = e;
          def.destroy(e);
        }
      });
    });
    def.on('error', (err) => {
      streamErr = err;
      reject(err);
    });
    def.on('end', () => {
      writeChain.then(resolve, reject);
    });
  });

  try {
    const readBuf = Buffer.allocUnsafe(STREAM_IO_CHUNK_BYTES);
    let pos = 0;
    while (pos < expectedSize && !streamErr) {
      const toRead = Math.min(readBuf.length, expectedSize - pos);
      const { bytesRead } = await srcHandle.read(readBuf, 0, toRead, pos);
      if (bytesRead <= 0) throw new Error(`Pack source truncated during compression: ${sourcePath}`);
      const slice = Buffer.from(readBuf.subarray(0, bytesRead));
      plainLen += bytesRead;
      crc = nativeCrc32(slice, crc);
      if (entrySha) entrySha.update(slice);
      if (!def.write(slice)) {
        await new Promise((resolve) => {
          const finish = () => {
            def.off('drain', finish);
            def.off('close', finish);
            def.off('error', finish);
            resolve();
          };
          def.once('drain', finish);
          def.once('close', finish);
          def.once('error', finish);
        });
      }
      pos += bytesRead;
    }
    // Check no trailing growth occurred in source file.
    const extraBuf = Buffer.allocUnsafe(1);
    const { bytesRead: extraRead } = await srcHandle.read(extraBuf, 0, 1, pos);
    if (extraRead > 0) throw new Error(`Pack source grew during compression: ${sourcePath}`);
    if (!streamErr) def.end();
    await done;
    if (plainLen !== expectedSize) {
      throw new Error(`Pack source size mismatch during compression: ${sourcePath}`);
    }
    return {
      crc: crc >>> 0,
      compSize,
      plainLen,
      entrySha256: entrySha ? entrySha.digest('hex') : null,
    };
  } finally {
    await Promise.allSettled([srcHandle.close(), shardHandle.close()]);
  }
}

async function copyFileIntoArchive(sourcePath, outHandle, expectedSize, expectedCrc, archiveHash, computeSha) {
  const srcHandle = await fsp.open(sourcePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(STREAM_IO_CHUNK_BYTES);
    let pos = 0;
    let crc = 0;
    const entrySha = computeSha ? createHash('sha256') : null;
    while (pos < expectedSize) {
      const toRead = Math.min(buf.length, expectedSize - pos);
      const { bytesRead } = await srcHandle.read(buf, 0, toRead, pos);
      if (bytesRead <= 0) throw new Error(`Source file truncated while writing archive: ${sourcePath}`);
      const slice = buf.subarray(0, bytesRead);
      if (expectedCrc !== null) crc = nativeCrc32(slice, crc);
      if (entrySha) entrySha.update(slice);
      await writeFullBuffer(outHandle, slice, archiveHash);
      pos += bytesRead;
    }
    const extraBuf = Buffer.allocUnsafe(1);
    const { bytesRead: extraRead } = await srcHandle.read(extraBuf, 0, 1, pos);
    if (extraRead > 0) throw new Error(`Source file grew while writing archive: ${sourcePath}`);
    if (expectedCrc !== null && (crc >>> 0) !== (expectedCrc >>> 0)) {
      throw new Error(`Source file changed while writing archive: ${sourcePath}`);
    }
    return entrySha ? entrySha.digest('hex') : null;
  } finally {
    await srcHandle.close();
  }
}

export async function writeNimiAppArchiveToFile(filePath, entries, options = {}) {
  const compress = options.compress !== false;
  const maxArchiveBytes = options.maxArchiveBytes ?? NATIVE_MAX_ARCHIVE_BYTES;
  const maxTotalUncompressedBytes = options.maxTotalUncompressedBytes ?? NATIVE_MAX_RELEASE_BYTES;
  const hashEntryName = options.hashEntryName ?? null;
  const normalized = entries.map((entry) => {
    const name = zipEntryName(entry.name);
    const rawName = Buffer.from(name, 'utf8');
    const mode = entry.mode === SYMBOLIC_LINK_MODE ? SYMBOLIC_LINK_MODE : entry.mode === 0o755 ? 0o755 : 0o644;
    if (entry.bytes !== undefined) {
      const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes);
      return { name, rawName, bytes, filePath: null, size: bytes.length, mode };
    }
    if (!entry.filePath || !Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`Invalid archive entry descriptor: ${name}`);
    }
    return { name, rawName, bytes: null, filePath: entry.filePath, size: entry.size, mode };
  }).sort((left, right) => Buffer.compare(left.rawName, right.rawName));

  if (normalized.length === 0 || normalized.length > MAX_ZIP32_ENTRIES) {
    throw new Error('nimiapp archive requires between 1 and 65535 files');
  }
  let totalUncompressed = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const entry = normalized[index];
    if (index > 0 && Buffer.compare(normalized[index - 1].rawName, entry.rawName) >= 0) {
      throw new Error('nimiapp archive entries must be unique');
    }
    if (entry.size > NATIVE_MAX_ENTRY_BYTES || entry.size >= 0xffffffff) {
      throw new Error(`Archive entry is too large: ${entry.name}`);
    }
    if (entry.mode === SYMBOLIC_LINK_MODE && (entry.size === 0 || entry.size > MAX_SYMLINK_TARGET_BYTES)) {
      throw new Error(`Invalid symbolic link target size: ${entry.name}`);
    }
    totalUncompressed += entry.size;
    if (totalUncompressed > maxTotalUncompressedBytes) {
      throw new Error(`Archive uncompressed size exceeds ${maxTotalUncompressedBytes} bytes`);
    }
  }

  const enforceExpansionBudget = totalUncompressed > EXPANSION_RATIO_FLOOR_BYTES;

  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const shardPath = `${tempPath}.shard`;
  const outHandle = await fsp.open(tempPath, 'w');
  const archiveHash = createHash('sha256');
  const centralParts = [];
  let offset = 0;
  let emittedUncompressed = 0;
  let hashedEntrySha256 = null;
  let renamed = false;

  try {
    for (const entry of normalized) {
      const wantHash = hashEntryName !== null && entry.name === hashEntryName;
      const uncompSize = entry.size;
      let method = ZIP_METHOD_STORE;
      let crc = 0;
      let compSize = 0;

      if (uncompSize === 0) {
        // Short-circuit 0 B regular files: never create a stream with end = start - 1.
        if (wantHash) hashedEntrySha256 = createHash('sha256').digest('hex');
        const nextOffset = offset + 30 + entry.rawName.length;
        if (nextOffset > maxArchiveBytes || nextOffset >= 0xffffffff) {
          throw new Error(`Archive exceeds maximum size budget (${maxArchiveBytes} bytes)`);
        }
        const local = buildLocalHeaderBuffer(entry.rawName, ZIP_METHOD_STORE, 0, 0, 0);
        await writeFullBuffer(outHandle, local, archiveHash);
        await writeFullBuffer(outHandle, entry.rawName, archiveHash);
      } else if (entry.bytes !== null || uncompSize <= STREAM_DEFLATE_THRESHOLD) {
        const plain = entry.bytes !== null ? entry.bytes : await fsp.readFile(entry.filePath);
        if (plain.length !== uncompSize) {
          throw new Error(`Pack source size changed before archive write: ${entry.name}`);
        }
        if (wantHash) hashedEntrySha256 = createHash('sha256').update(plain).digest('hex');
        crc = nativeCrc32(plain);
        let payload = plain;
        if (compress && entry.mode !== SYMBOLIC_LINK_MODE) {
          const deflated = deflateRawSync(plain, { level: DEFLATE_LEVEL });
          const fitsBudget = !enforceExpansionBudget
            || emittedUncompressed + uncompSize <= (offset + 30 + entry.rawName.length + deflated.length) * MAX_EXPANSION_RATIO;
          if (deflated.length > 0 && deflated.length < uncompSize && fitsBudget) {
            method = ZIP_METHOD_DEFLATE;
            payload = deflated;
          }
        }
        compSize = payload.length;
        const nextOffset = offset + 30 + entry.rawName.length + compSize;
        if (nextOffset > maxArchiveBytes || nextOffset >= 0xffffffff) {
          throw new Error(`Archive exceeds maximum size budget (${maxArchiveBytes} bytes)`);
        }
        const local = buildLocalHeaderBuffer(entry.rawName, method, crc, compSize, uncompSize);
        await writeFullBuffer(outHandle, local, archiveHash);
        await writeFullBuffer(outHandle, entry.rawName, archiveHash);
        await writeFullBuffer(outHandle, payload, archiveHash);
      } else if (compress) {
        try {
          const stats = await streamDeflateFileToShard(entry.filePath, shardPath, uncompSize, wantHash);
          crc = stats.crc;
          if (wantHash) hashedEntrySha256 = stats.entrySha256;
          const fitsBudget = !enforceExpansionBudget
            || emittedUncompressed + uncompSize <= (offset + 30 + entry.rawName.length + stats.compSize) * MAX_EXPANSION_RATIO;
          if (stats.compSize > 0 && stats.compSize < uncompSize && fitsBudget) {
            method = ZIP_METHOD_DEFLATE;
            compSize = stats.compSize;
            const nextOffset = offset + 30 + entry.rawName.length + compSize;
            if (nextOffset > maxArchiveBytes || nextOffset >= 0xffffffff) {
              throw new Error(`Archive exceeds maximum size budget (${maxArchiveBytes} bytes)`);
            }
            const local = buildLocalHeaderBuffer(entry.rawName, method, crc, compSize, uncompSize);
            await writeFullBuffer(outHandle, local, archiveHash);
            await writeFullBuffer(outHandle, entry.rawName, archiveHash);
            await copyFileIntoArchive(shardPath, outHandle, compSize, null, archiveHash, false);
          } else {
            method = ZIP_METHOD_STORE;
            compSize = uncompSize;
            const nextOffset = offset + 30 + entry.rawName.length + compSize;
            if (nextOffset > maxArchiveBytes || nextOffset >= 0xffffffff) {
              throw new Error(`Archive exceeds maximum size budget (${maxArchiveBytes} bytes)`);
            }
            const local = buildLocalHeaderBuffer(entry.rawName, method, crc, compSize, uncompSize);
            await writeFullBuffer(outHandle, local, archiveHash);
            await writeFullBuffer(outHandle, entry.rawName, archiveHash);
            const storeSha = await copyFileIntoArchive(entry.filePath, outHandle, uncompSize, crc, archiveHash, wantHash);
            if (wantHash && storeSha !== hashedEntrySha256) {
              throw new Error(`Runtime entry changed while writing archive: ${entry.name}`);
            }
          }
        } finally {
          await fsp.rm(shardPath, { force: true });
        }
      } else {
        // Large uncompressed Store entry
        const srcHandle = await fsp.open(entry.filePath, 'r');
        try {
          const buf = Buffer.allocUnsafe(STREAM_IO_CHUNK_BYTES);
          let pos = 0;
          const entrySha = wantHash ? createHash('sha256') : null;
          while (pos < uncompSize) {
            const { bytesRead } = await srcHandle.read(buf, 0, Math.min(buf.length, uncompSize - pos), pos);
            if (bytesRead <= 0) throw new Error(`Source file truncated: ${entry.name}`);
            const slice = buf.subarray(0, bytesRead);
            crc = nativeCrc32(slice, crc);
            if (entrySha) entrySha.update(slice);
            pos += bytesRead;
          }
          if (entrySha) hashedEntrySha256 = entrySha.digest('hex');
        } finally {
          await srcHandle.close();
        }
        method = ZIP_METHOD_STORE;
        compSize = uncompSize;
        const nextOffset = offset + 30 + entry.rawName.length + compSize;
        if (nextOffset > maxArchiveBytes || nextOffset >= 0xffffffff) {
          throw new Error(`Archive exceeds maximum size budget (${maxArchiveBytes} bytes)`);
        }
        const local = buildLocalHeaderBuffer(entry.rawName, method, crc, compSize, uncompSize);
        await writeFullBuffer(outHandle, local, archiveHash);
        await writeFullBuffer(outHandle, entry.rawName, archiveHash);
        await copyFileIntoArchive(entry.filePath, outHandle, uncompSize, crc, archiveHash, false);
      }

      const central = buildCentralHeaderBuffer(
        entry.rawName,
        method,
        crc,
        compSize,
        uncompSize,
        encodeCanonicalExternalAttrs(entry.mode),
        offset,
      );
      centralParts.push(central, entry.rawName);
      offset += 30 + entry.rawName.length + compSize;
      emittedUncompressed += uncompSize;
    }

    const central = Buffer.concat(centralParts);
    const finalSize = offset + central.length + 22;
    if (finalSize > maxArchiveBytes || finalSize >= 0xffffffff) {
      throw new Error(`Archive exceeds maximum size budget (${maxArchiveBytes} bytes)`);
    }
    if (totalUncompressed > EXPANSION_RATIO_FLOOR_BYTES && totalUncompressed > finalSize * MAX_EXPANSION_RATIO) {
      throw new Error(`Archive expansion ratio exceeds ${MAX_EXPANSION_RATIO}x (${totalUncompressed} / ${finalSize})`);
    }
    const end = buildEocdBuffer(normalized.length, central.length, offset);
    await writeFullBuffer(outHandle, central, archiveHash);
    await writeFullBuffer(outHandle, end, archiveHash);
    await outHandle.close();
    await fsp.rename(tempPath, filePath);
    renamed = true;
    return {
      size: finalSize,
      sha256: archiveHash.digest('hex'),
      totalUncompressed,
      hashedEntrySha256,
    };
  } finally {
    await outHandle.close().catch(() => {});
    await fsp.rm(shardPath, { force: true }).catch(() => {});
    if (!renamed) {
      await fsp.rm(tempPath, { force: true }).catch(() => {});
    }
  }
}

function parseCentralAndValidateMetadata(archiveSize, eocd, cdBuf, options, readLocalSlice) {
  const maxArchiveBytes = options.maxArchiveBytes ?? NATIVE_MAX_ARCHIVE_BYTES;
  const maxTotalUncompressedBytes = options.maxTotalUncompressedBytes ?? NATIVE_MAX_RELEASE_BYTES;
  const nimiappLayout = options.nimiappLayout === true;
  if (archiveSize < 22 || archiveSize > maxArchiveBytes || archiveSize >= 0xffffffff) {
    throw new Error('Invalid nimiapp ZIP archive size');
  }
  if (eocd.readUInt32LE(0) !== 0x06054b50) throw new Error('Invalid nimiapp ZIP end record');
  const diskNumber = eocd.readUInt16LE(4);
  const centralDisk = eocd.readUInt16LE(6);
  const entriesOnDisk = eocd.readUInt16LE(8);
  const count = eocd.readUInt16LE(10);
  const centralSize = eocd.readUInt32LE(12);
  const centralOffset = eocd.readUInt32LE(16);
  const commentLen = eocd.readUInt16LE(20);
  const endOffset = archiveSize - 22;
  if (
    diskNumber !== 0
    || centralDisk !== 0
    || commentLen !== 0
    || entriesOnDisk !== count
    || count === 0
    || count > MAX_ZIP32_ENTRIES
    || centralSize === 0
    || centralSize === 0xffffffff
    || centralOffset === 0xffffffff
    || centralOffset + centralSize !== endOffset
  ) {
    throw new Error('Invalid nimiapp ZIP directory');
  }
  return { count, centralSize, centralOffset, maxTotalUncompressedBytes, nimiappLayout };
}

function validateCentralEntryFields(cdBuf, cursor, cdEnd, expectedOffset, centralOffset, prevRawName, nimiappLayout, maxTotalUncompressedBytes, totalUncompressed) {
  if (cursor + 46 > cdEnd) throw new Error('Invalid nimiapp ZIP central entry truncated');
  if (cdBuf.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid nimiapp ZIP central entry');
  const creatorVersion = cdBuf.readUInt16LE(cursor + 4);
  const readerVersion = cdBuf.readUInt16LE(cursor + 6);
  const flags = cdBuf.readUInt16LE(cursor + 8);
  const method = cdBuf.readUInt16LE(cursor + 10);
  const modTime = cdBuf.readUInt16LE(cursor + 12);
  const modDate = cdBuf.readUInt16LE(cursor + 14);
  const expectedCrc = cdBuf.readUInt32LE(cursor + 16);
  const compSize = cdBuf.readUInt32LE(cursor + 20);
  const uncompSize = cdBuf.readUInt32LE(cursor + 24);
  const nameLen = cdBuf.readUInt16LE(cursor + 28);
  const extraLen = cdBuf.readUInt16LE(cursor + 30);
  const commentLen = cdBuf.readUInt16LE(cursor + 32);
  const diskStart = cdBuf.readUInt16LE(cursor + 34);
  const internalAttrs = cdBuf.readUInt16LE(cursor + 36);
  const externalAttrs = cdBuf.readUInt32LE(cursor + 38);
  const localOffset = cdBuf.readUInt32LE(cursor + 42);
  if (
    creatorVersion !== ZIP_CREATOR_UNIX
    || readerVersion !== ZIP_READER_VERSION
    || flags !== ZIP_FLAGS_UTF8
    || extraLen !== 0
    || commentLen !== 0
    || diskStart !== 0
    || internalAttrs !== 0
    || compSize === 0xffffffff
    || uncompSize === 0xffffffff
    || localOffset === 0xffffffff
    || nameLen === 0
    || nameLen > MAX_ARCHIVE_ENTRY_NAME_BYTES
    || cursor + 46 + nameLen > cdEnd
  ) {
    throw new Error('Invalid nimiapp ZIP entry header');
  }
  const mode = parseCanonicalExternalAttrs(externalAttrs);
  const rawName = cdBuf.subarray(cursor + 46, cursor + 46 + nameLen);
  const name = zipEntryName(decodeStrictUtf8(rawName, 'nimiapp ZIP entry name'));
  if (prevRawName !== null && Buffer.compare(prevRawName, rawName) >= 0) {
    throw new Error('Invalid nimiapp ZIP entries are not canonical');
  }
  if (mode === SYMBOLIC_LINK_MODE) {
    if (method !== ZIP_METHOD_STORE || compSize !== uncompSize || uncompSize === 0 || uncompSize > MAX_SYMLINK_TARGET_BYTES) {
      throw new Error(`Invalid nimiapp ZIP symbolic link entry: ${name}`);
    }
  } else if (method === ZIP_METHOD_STORE) {
    if (compSize !== uncompSize || uncompSize > NATIVE_MAX_ENTRY_BYTES || (uncompSize === 0 && expectedCrc !== 0)) {
      throw new Error(`Invalid nimiapp ZIP Store entry: ${name}`);
    }
  } else if (method === ZIP_METHOD_DEFLATE) {
    if (compSize === 0 || uncompSize === 0 || compSize >= uncompSize || uncompSize > NATIVE_MAX_ENTRY_BYTES) {
      throw new Error(`Invalid nimiapp ZIP Deflate entry: ${name}`);
    }
  } else {
    throw new Error(`Invalid nimiapp ZIP unsupported compression method ${method}: ${name}`);
  }
  if (nimiappLayout) {
    validateNimiappLayoutEntry(name, mode, uncompSize);
  }
  if (localOffset !== expectedOffset) {
    throw new Error(`Invalid nimiapp ZIP non-contiguous local offset: ${name}`);
  }
  const dataOffset = localOffset + 30 + nameLen;
  const nextOffset = dataOffset + compSize;
  if (nextOffset < dataOffset || nextOffset > centralOffset) {
    throw new Error(`Invalid nimiapp ZIP local data bounds: ${name}`);
  }
  const nextTotalUncompressed = totalUncompressed + uncompSize;
  if (nextTotalUncompressed > maxTotalUncompressedBytes) {
    throw new Error(`Invalid nimiapp ZIP uncompressed size exceeds ${maxTotalUncompressedBytes} bytes`);
  }
  return {
    name,
    rawName,
    mode,
    method,
    modTime,
    modDate,
    expectedCrc,
    compSize,
    uncompSize,
    localOffset,
    dataOffset,
    nextOffset,
    nextCursor: cursor + 46 + nameLen,
    nextTotalUncompressed,
  };
}

function assertLocalHeaderMatches(localBuf, meta) {
  if (
    localBuf.length !== 30 + meta.rawName.length
    || localBuf.readUInt32LE(0) !== 0x04034b50
    || localBuf.readUInt16LE(4) !== ZIP_READER_VERSION
    || localBuf.readUInt16LE(6) !== ZIP_FLAGS_UTF8
    || localBuf.readUInt16LE(8) !== meta.method
    || localBuf.readUInt16LE(10) !== meta.modTime
    || localBuf.readUInt16LE(12) !== meta.modDate
    || localBuf.readUInt32LE(14) !== meta.expectedCrc
    || localBuf.readUInt32LE(18) !== meta.compSize
    || localBuf.readUInt32LE(22) !== meta.uncompSize
    || localBuf.readUInt16LE(26) !== meta.rawName.length
    || localBuf.readUInt16LE(28) !== 0
    || !localBuf.subarray(30).equals(meta.rawName)
  ) {
    throw new Error(`Invalid nimiapp ZIP local header mismatch: ${meta.name}`);
  }
}

export function readNimiAppArchive(bytes, options = {}) {
  const archive = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const maxArchiveBytes = options.maxArchiveBytes ?? NATIVE_MAX_ARCHIVE_BYTES;
  const retainPredicate = typeof options.retainPredicate === 'function' ? options.retainPredicate : null;
  if (archive.length < 22 || archive.length > maxArchiveBytes || archive.length >= 0xffffffff) {
    throw new Error('Invalid nimiapp ZIP end record');
  }
  const eocd = archive.subarray(archive.length - 22);
  const { count, centralSize, centralOffset, maxTotalUncompressedBytes, nimiappLayout } =
    parseCentralAndValidateMetadata(archive.length, eocd, null, options);
  const cdBuf = archive.subarray(centralOffset, centralOffset + centralSize);
  const parsed = [];
  let cursor = 0;
  let expectedOffset = 0;
  let totalUncompressed = 0;
  let prevRawName = null;
  for (let index = 0; index < count; index += 1) {
    const meta = validateCentralEntryFields(
      cdBuf,
      cursor,
      centralSize,
      expectedOffset,
      centralOffset,
      prevRawName,
      nimiappLayout,
      maxTotalUncompressedBytes,
      totalUncompressed,
    );
    const localBuf = archive.subarray(meta.localOffset, meta.dataOffset);
    assertLocalHeaderMatches(localBuf, meta);
    parsed.push(meta);
    cursor = meta.nextCursor;
    expectedOffset = meta.nextOffset;
    totalUncompressed = meta.nextTotalUncompressed;
    prevRawName = meta.rawName;
  }
  if (cursor !== centralSize || expectedOffset !== centralOffset) {
    throw new Error('Invalid nimiapp ZIP directory layout');
  }
  if (totalUncompressed > EXPANSION_RATIO_FLOOR_BYTES && totalUncompressed > archive.length * MAX_EXPANSION_RATIO) {
    throw new Error(`Invalid nimiapp ZIP expansion ratio exceeds ${MAX_EXPANSION_RATIO}x`);
  }

  const entries = new Map();
  for (const meta of parsed) {
    const rawSlice = archive.subarray(meta.dataOffset, meta.dataOffset + meta.compSize);
    if (rawSlice.length !== meta.compSize) {
      throw new Error(`Invalid nimiapp ZIP truncated entry: ${meta.name}`);
    }
    let plain;
    if (meta.method === ZIP_METHOD_STORE) {
      if (meta.uncompSize > 0 && nativeCrc32(rawSlice) !== meta.expectedCrc) {
        throw new Error(`Invalid nimiapp ZIP entry digest mismatch: ${meta.name}`);
      }
      plain = rawSlice;
    } else {
      let inflated;
      try {
        inflated = inflateRawSync(rawSlice, { maxOutputLength: meta.uncompSize, info: true });
      } catch (error) {
        throw new Error(`Invalid nimiapp ZIP deflate payload for ${meta.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (inflated.buffer.length !== meta.uncompSize || inflated.engine.bytesWritten !== meta.compSize) {
        throw new Error(`Invalid nimiapp ZIP deflate length or trailing bytes: ${meta.name}`);
      }
      if (nativeCrc32(inflated.buffer) !== meta.expectedCrc) {
        throw new Error(`Invalid nimiapp ZIP entry digest mismatch: ${meta.name}`);
      }
      plain = inflated.buffer;
    }
    const retain = meta.mode === SYMBOLIC_LINK_MODE || !retainPredicate || retainPredicate(meta.name, { mode: meta.mode, size: meta.uncompSize });
    entries.set(meta.name, Object.freeze({
      bytes: retain ? Buffer.from(plain) : null,
      size: meta.uncompSize,
      mode: meta.mode,
    }));
  }
  return entries;
}

async function readStoreEntryFromHandle(handle, meta, retain, budgetState) {
  if (meta.uncompSize === 0) {
    return retain ? Buffer.alloc(0) : null;
  }
  const buf = Buffer.allocUnsafe(Math.min(STREAM_IO_CHUNK_BYTES, meta.compSize));
  let offset = 0;
  let crc = 0;
  const chunks = retain ? [] : null;
  while (offset < meta.compSize) {
    const toRead = Math.min(buf.length, meta.compSize - offset);
    const { bytesRead } = await handle.read(buf, 0, toRead, meta.dataOffset + offset);
    if (bytesRead <= 0) throw new Error(`Invalid nimiapp ZIP truncated Store entry: ${meta.name}`);
    const slice = buf.subarray(0, bytesRead);
    budgetState.total += bytesRead;
    if (budgetState.total > budgetState.maxTotal) {
      throw new Error(`Invalid nimiapp ZIP uncompressed budget exceeded: ${meta.name}`);
    }
    crc = nativeCrc32(slice, crc);
    if (chunks) chunks.push(Buffer.from(slice));
    offset += bytesRead;
  }
  if ((crc >>> 0) !== (meta.expectedCrc >>> 0)) {
    throw new Error(`Invalid nimiapp ZIP entry digest mismatch: ${meta.name}`);
  }
  return chunks ? Buffer.concat(chunks) : null;
}

async function readDeflateEntryFromHandle(handle, meta, retain, budgetState) {
  // Never rely on createInflateRaw({ maxOutputLength }): Node v24 Transform
  // silently ignores it. Enforce per-entry and total uncompressed bounds
  // strictly inside our single bounded consumer before updating CRC or retaining.
  const inf = createInflateRaw();
  let outLen = 0;
  let crc = 0;
  let aborted = null;
  const chunks = retain ? [] : null;
  const done = new Promise((resolve, reject) => {
    inf.on('data', (chunk) => {
      if (aborted) return;
      if (outLen + chunk.length > meta.uncompSize || budgetState.total + chunk.length > budgetState.maxTotal) {
        aborted = new Error(`Invalid nimiapp ZIP deflate uncompressed overflow: ${meta.name}`);
        inf.destroy(aborted);
        return;
      }
      outLen += chunk.length;
      budgetState.total += chunk.length;
      crc = nativeCrc32(chunk, crc);
      if (chunks) chunks.push(Buffer.from(chunk));
    });
    inf.on('error', (error) => {
      const wrapped = error === aborted
        ? error
        : new Error(`Invalid nimiapp ZIP deflate payload for ${meta.name}: ${error instanceof Error ? error.message : String(error)}`);
      aborted = wrapped;
      reject(wrapped);
    });
    inf.on('end', () => {
      resolve();
    });
  });

  const buf = Buffer.allocUnsafe(Math.min(STREAM_IO_CHUNK_BYTES, meta.compSize));
  let offset = 0;
  while (offset < meta.compSize && !aborted) {
    const toRead = Math.min(buf.length, meta.compSize - offset);
    const { bytesRead } = await handle.read(buf, 0, toRead, meta.dataOffset + offset);
    if (bytesRead <= 0) {
      const truncErr = new Error(`Invalid nimiapp ZIP truncated Deflate entry: ${meta.name}`);
      aborted = truncErr;
      inf.destroy(truncErr);
      break;
    }
    const slice = Buffer.from(buf.subarray(0, bytesRead));
    if (!inf.write(slice)) {
      await new Promise((resolve) => {
        const finish = () => {
          inf.off('drain', finish);
          inf.off('close', finish);
          inf.off('error', finish);
          resolve();
        };
        inf.once('drain', finish);
        inf.once('close', finish);
        inf.once('error', finish);
      });
    }
    offset += bytesRead;
  }
  if (!aborted) inf.end();
  await done;
  if (outLen !== meta.uncompSize || inf.bytesWritten !== meta.compSize) {
    throw new Error(`Invalid nimiapp ZIP deflate length or trailing bytes: ${meta.name}`);
  }
  if ((crc >>> 0) !== (meta.expectedCrc >>> 0)) {
    throw new Error(`Invalid nimiapp ZIP entry digest mismatch: ${meta.name}`);
  }
  return chunks ? Buffer.concat(chunks) : null;
}

export async function readNimiAppArchiveFromFile(source, options = {}) {
  const retainPredicate = typeof options.retainPredicate === 'function' ? options.retainPredicate : null;
  let handle;
  let archiveSize;
  let ownHandle = false;
  if (typeof source === 'string') {
    handle = await fsp.open(source, 'r');
    ownHandle = true;
    const stat = await handle.stat();
    if (!stat.isFile()) {
      await handle.close();
      throw new Error('Invalid nimiapp ZIP archive source');
    }
    archiveSize = stat.size;
  } else if (source && source.handle && Number.isSafeInteger(source.size)) {
    handle = source.handle;
    archiveSize = source.size;
  } else {
    throw new Error('Invalid nimiapp ZIP archive source');
  }

  try {
    const maxArchiveBytes = options.maxArchiveBytes ?? NATIVE_MAX_ARCHIVE_BYTES;
    if (archiveSize < 22 || archiveSize > maxArchiveBytes || archiveSize >= 0xffffffff) {
      throw new Error('Invalid nimiapp ZIP archive size');
    }
    const eocd = await readExactFromHandle(handle, Buffer.allocUnsafe(22), archiveSize - 22);
    const { count, centralSize, centralOffset, maxTotalUncompressedBytes, nimiappLayout } =
      parseCentralAndValidateMetadata(archiveSize, eocd, null, options);
    const cdBuf = await readExactFromHandle(handle, Buffer.allocUnsafe(centralSize), centralOffset);
    const parsed = [];
    let cursor = 0;
    let expectedOffset = 0;
    let totalUncompressed = 0;
    let prevRawName = null;
    for (let index = 0; index < count; index += 1) {
      const meta = validateCentralEntryFields(
        cdBuf,
        cursor,
        centralSize,
        expectedOffset,
        centralOffset,
        prevRawName,
        nimiappLayout,
        maxTotalUncompressedBytes,
        totalUncompressed,
      );
      const localBuf = await readExactFromHandle(handle, Buffer.allocUnsafe(30 + meta.rawName.length), meta.localOffset);
      assertLocalHeaderMatches(localBuf, meta);
      parsed.push(meta);
      cursor = meta.nextCursor;
      expectedOffset = meta.nextOffset;
      totalUncompressed = meta.nextTotalUncompressed;
      prevRawName = meta.rawName;
    }
    if (cursor !== centralSize || expectedOffset !== centralOffset) {
      throw new Error('Invalid nimiapp ZIP directory layout');
    }
    if (totalUncompressed > EXPANSION_RATIO_FLOOR_BYTES && totalUncompressed > archiveSize * MAX_EXPANSION_RATIO) {
      throw new Error(`Invalid nimiapp ZIP expansion ratio exceeds ${MAX_EXPANSION_RATIO}x`);
    }

    const entries = new Map();
    const budgetState = { total: 0, maxTotal: maxTotalUncompressedBytes };
    for (const meta of parsed) {
      const retain = meta.mode === SYMBOLIC_LINK_MODE || !retainPredicate || retainPredicate(meta.name, { mode: meta.mode, size: meta.uncompSize });
      const data = meta.method === ZIP_METHOD_STORE
        ? await readStoreEntryFromHandle(handle, meta, retain, budgetState)
        : await readDeflateEntryFromHandle(handle, meta, retain, budgetState);
      entries.set(meta.name, Object.freeze({
        bytes: data,
        size: meta.uncompSize,
        mode: meta.mode,
      }));
    }
    return entries;
  } finally {
    if (ownHandle) await handle.close().catch(() => {});
  }
}

function readNativePackProfile(targetDir) {
  const profile = readYaml(path.join(targetDir, BUILD_PROFILE_PATH), BUILD_PROFILE_PATH);
  assertDesktopHostSupport(profile.build_profile_ref);
  if (![MANAGED_WEB_BUILD_PROFILE_REF, ELECTRON_BUILD_PROFILE_REF, APP_OWNED_ELECTRON_BUILD_PROFILE_REF].includes(profile.build_profile_ref)) {
    throw new Error(`${BUILD_PROFILE_PATH} build_profile_ref is unsupported: ${String(profile.build_profile_ref)}`);
  }
  return profile;
}

function readPackInputs(targetDir, targetId) {
  const buildProfile = readNativePackProfile(targetDir);
  const target = TARGETS[targetId];
  if (!target) throw new Error(`Unsupported App package target: ${targetId}`);
  const isManagedWeb = buildProfile.build_profile_ref === MANAGED_WEB_BUILD_PROFILE_REF;
  if (isManagedWeb && targetId !== 'desktop-universal') {
    throw new Error(`managed-web-pnpm-vite only supports target desktop-universal, got: ${targetId}`);
  }
  if (!isManagedWeb && targetId === 'desktop-universal') {
    throw new Error(`Target desktop-universal requires build_profile_ref ${MANAGED_WEB_BUILD_PROFILE_REF}`);
  }
  const packageJson = readJson(path.join(targetDir, 'package.json'), 'package.json');
  const licensePath = path.join(targetDir, 'LICENSE');
  if (!existsSync(licensePath)) throw new Error('App package LICENSE is missing');
  const licenseStat = lstatSync(licensePath);
  if (!licenseStat.isFile() || licenseStat.isSymbolicLink() || licenseStat.size === 0 || licenseStat.size > MAX_LICENSE_BYTES) {
    throw new Error(`App package LICENSE must be a non-empty direct regular file within ${MAX_LICENSE_BYTES} bytes`);
  }
  const manifestPath = path.join(targetDir, 'nimi.app.yaml');
  const manifest = readYaml(manifestPath, 'nimi.app.yaml');
  const desktop = validateManifestDesktop(manifest.desktop, 'nimi.app.yaml desktop');
  const appInfo = readAppInfo(targetDir, targetId);
  if (isManagedWeb && appInfo.storage_policy?.kind !== 'nimi-mediated-default') {
    throw new Error('managed-web packages require storage_policy.kind: nimi-mediated-default');
  }
  const appId = String(manifest.app_id || '');
  const version = String(packageJson.version || '');
  if (!isAppId(appId)) throw new Error('nimi.app.yaml app_id must be canonical and dotted');
  if (!SEMVER_PATTERN.test(version) || manifest.version !== version) {
    throw new Error('package.json and nimi.app.yaml versions must be exact and lockstep before pack');
  }
  const configured = buildProfile.targets?.[targetId];
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) throw new Error(`Build profile does not declare target: ${targetId}`);
  if (configured.os !== target.os || configured.arch !== target.arch) throw new Error(`Build profile target identity mismatch: ${targetId}`);
  const payload = resolveInside(targetDir, configured.payload_path, `targets.${targetId}.payload_path`);
  const outputDir = path.join(targetDir, OUTPUT_DIR);
  if (pathsOverlapOrEqual(payload.resolved, outputDir)) {
    throw new Error(`Pack payload_path (${payload.normalized}) must not overlap ${OUTPUT_DIR}; emit build output to a sibling directory such as dist/renderer`);
  }
  if (!existsSync(payload.resolved)) throw new Error(`Built target payload is missing: ${payload.normalized}`);
  const runtimeEntry = canonicalRelative(configured.runtime_entry, `targets.${targetId}.runtime_entry`);
  if (!runtimeEntry.startsWith('payload/')) throw new Error('runtime_entry must resolve inside the packaged payload');
  if (isManagedWeb && runtimeEntry !== MANAGED_WEB_RUNTIME_ENTRY) {
    throw new Error(`managed-web runtime_entry must be ${MANAGED_WEB_RUNTIME_ENTRY}`);
  }
  const payloadStat = lstatSync(payload.resolved);
  const runtimeRelative = runtimeEntry.slice('payload/'.length);
  const runtimeHostPath = payloadStat.isFile()
    ? payload.resolved
    : resolveInside(payload.resolved, runtimeRelative, `targets.${targetId}.runtime_entry`).resolved;
  return { buildProfile, desktop, target, targetId, targetDir, packageJson, licensePath, manifestPath, appInfo, appId, version, payloadPath: payload.resolved, runtimeEntry, runtimeHostPath };
}

export function classifyWindowsNativeTrustObservation(observation) {
  const {
    status,
    signature_type: signatureType,
    certificate_subject: certificateSubject,
  } = observation || {};
  if (status === 'NotSigned' && signatureType === 'None' && certificateSubject === null) {
    return Object.freeze({
      posture: 'production-unsigned',
      windows_authenticode: 'unsigned',
      certificate_subject: null,
    });
  }
  if (
    status === 'Valid'
    && signatureType === 'Authenticode'
    && typeof certificateSubject === 'string'
    && certificateSubject.length > 0
    && certificateSubject === certificateSubject.trim()
  ) {
    return Object.freeze({
      posture: 'observed-valid-native-signature',
      windows_authenticode: 'valid',
      certificate_subject: certificateSubject,
    });
  }
  throw new Error(`Windows Authenticode verification failed: status=${String(status)}, type=${String(signatureType)}, signer=${certificateSubject === null ? 'absent' : 'present'}`);
}

async function observeProductionWindowsFacts(input, expectedRuntimeSha256) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Production Windows pack must run on windows-x86_64');
  const observed = observeWindowsExecutableFacts(input.runtimeHostPath);
  const currentSha = await hashFilePath(input.runtimeHostPath);
  if (currentSha !== expectedRuntimeSha256) {
    throw new Error('Production Runtime entry changed while native and execution facts were observed');
  }
  const nativeTrust = classifyWindowsNativeTrustObservation(observed.authenticode);
  return { nativeTrust, executionProfile: observed.execution_profile };
}

async function resolveTargetFacts(input, production, expectedRuntimeSha256) {
  if (input.target.os === 'any') {
    return {
      nativeTrust: {
        posture: 'nimi-managed-carrier',
        certificate_subject: null,
      },
      executionProfile: {
        launch_mode: MANAGED_WEB_EXECUTION_PROFILE_REF,
      },
    };
  }
  if (!production) {
    return {
      nativeTrust: { posture: 'development-unsigned' },
      executionProfile: null,
    };
  }
  if (input.target.os === 'macos') {
    const facts = observeMacOSExecutableFacts(input.runtimeHostPath);
    if ((await hashFilePath(input.runtimeHostPath)) !== expectedRuntimeSha256) {
      throw new Error('Production Runtime entry changed during macOS native observation');
    }
    return facts;
  }
  return observeProductionWindowsFacts(input, expectedRuntimeSha256);
}

function validateNativeExecutionFacts(nativeTrust, executionProfile, label, os) {
  if (!nativeTrust || typeof nativeTrust !== 'object' || Array.isArray(nativeTrust)) {
    throw new Error(`${label} native_trust must be an object`);
  }
  if (os === 'any') {
    if (
      !executionProfile
      || typeof executionProfile !== 'object'
      || Array.isArray(executionProfile)
      || Object.keys(executionProfile).join(',') !== 'launch_mode'
      || executionProfile.launch_mode !== MANAGED_WEB_EXECUTION_PROFILE_REF
    ) {
      throw new Error(`${label} managed-web execution_profile must use ${MANAGED_WEB_EXECUTION_PROFILE_REF}`);
    }
    if (
      Object.keys(nativeTrust).sort().join(',') !== 'certificate_subject,posture'
      || nativeTrust.posture !== 'nimi-managed-carrier'
      || nativeTrust.certificate_subject !== null
    ) {
      throw new Error(`${label} managed-web native_trust posture is inconsistent`);
    }
    return;
  }
  if (nativeTrust.posture === 'development-unsigned') {
    if (executionProfile !== null || Object.keys(nativeTrust).length !== 1) {
      throw new Error(`${label} development native/execution posture is inconsistent`);
    }
    return;
  }
  if (os === 'macos') {
    if (!executionProfile || Object.keys(executionProfile).join(',') !== 'launch_mode' || executionProfile.launch_mode !== 'current-user') throw new Error(`${label} macOS execution_profile must use current-user launch`);
    if (Object.keys(nativeTrust).sort().join(',') !== 'certificate_subject,macos_developer_id,macos_notarization,posture') throw new Error(`${label} macOS native_trust is inconsistent`);
    if (nativeTrust.posture === 'production-unsigned' && nativeTrust.macos_developer_id === 'absent' && nativeTrust.macos_notarization === 'absent' && nativeTrust.certificate_subject === null) return;
    if (nativeTrust.posture === 'observed-valid-native-signature' && nativeTrust.macos_developer_id === 'valid' && ['absent', 'notarized'].includes(nativeTrust.macos_notarization) && typeof nativeTrust.certificate_subject === 'string' && nativeTrust.certificate_subject.trim() === nativeTrust.certificate_subject && nativeTrust.certificate_subject) return;
    throw new Error(`${label} macOS native_trust posture is inconsistent`);
  }
  if (
    !executionProfile
    || typeof executionProfile !== 'object'
    || Array.isArray(executionProfile)
    || executionProfile.requested_execution_level !== 'asInvoker'
    || executionProfile.ui_access !== false
    || Object.keys(executionProfile).sort().join(',') !== 'requested_execution_level,ui_access'
  ) {
    throw new Error(`${label} ordinary Windows execution_profile must be exactly asInvoker with ui_access=false`);
  }
  if (nativeTrust.posture === 'production-unsigned') {
    if (
      nativeTrust.windows_authenticode !== 'unsigned'
      || nativeTrust.certificate_subject !== null
      || Object.keys(nativeTrust).sort().join(',') !== 'certificate_subject,posture,windows_authenticode'
    ) {
      throw new Error(`${label} production unsigned native_trust is inconsistent`);
    }
    return;
  }
  if (nativeTrust.posture === 'observed-valid-native-signature') {
    if (
      nativeTrust.windows_authenticode !== 'valid'
      || typeof nativeTrust.certificate_subject !== 'string'
      || !nativeTrust.certificate_subject
      || nativeTrust.certificate_subject !== nativeTrust.certificate_subject.trim()
      || Object.keys(nativeTrust).sort().join(',') !== 'certificate_subject,posture,windows_authenticode'
    ) {
      throw new Error(`${label} signed native_trust is inconsistent`);
    }
    return;
  }
  throw new Error(`${label} native_trust posture is unsupported`);
}

function readPackageManifestFromArchive(entries, label) {
  const entry = entries.get('manifest.json');
  if (!entry || !entry.bytes) throw new Error(`${label} archive manifest.json is missing`);
  try {
    const manifest = JSON.parse(entry.bytes.toString('utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('root must be an object');
    return manifest;
  } catch (error) {
    throw new Error(`${label} archive manifest.json is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function packAppTarget(cwd, options = {}) {
  const targetDir = path.resolve(cwd, String(options.dir || '').trim() || '.');
  const targetId = String(options.target || '').trim();
  if (!targetId) throw new Error('nimi-app pack requires --target');
  const input = readPackInputs(targetDir, targetId);
  const isManagedWeb = input.target.os === 'any';
  const payloadEntries = collectPayload(input.payloadPath, input.target.os).map((entry) => {
    const name = `payload/${entry.relative.replaceAll('\\', '/')}`;
    if (name === input.runtimeEntry && entry.mode === SYMBOLIC_LINK_MODE) throw new Error('Runtime entry must be a direct regular file');
    const mode = isManagedWeb
      ? 0o644
      : name === input.runtimeEntry ? 0o755 : entry.mode;
    return {
      name,
      ...(entry.bytes !== undefined ? { bytes: entry.bytes } : { filePath: entry.filePath }),
      size: entry.size,
      mode,
    };
  });
  validatePayloadLinks(new Map(payloadEntries.map((entry) => [entry.name, entry])), input.target.os);
  const runtimeEntry = payloadEntries.find((entry) => entry.name === input.runtimeEntry);
  if (!runtimeEntry) throw new Error(`runtime_entry is missing from target payload: ${input.runtimeEntry}`);
  const expectedRuntimeSha256 = await hashFilePath(input.runtimeHostPath);
  const { nativeTrust, executionProfile } = await resolveTargetFacts(input, options.production === true, expectedRuntimeSha256);
  const packageManifest = {
    format: PACKAGE_FORMAT,
    app_id: input.appId,
    version: input.version,
    target_id: input.targetId,
    os: input.target.os,
    arch: input.target.arch,
    runtime_entry: input.runtimeEntry,
    native_trust: nativeTrust,
    execution_profile: executionProfile,
  };
  const infoBytes = Buffer.from(canonicalJson(input.appInfo));
  if (infoBytes.length > APP_INFO_MAX_BYTES) throw new Error('App info exceeds 1 MiB');
  // An undeclared safety_profile stays absent from the declaration copy; it is
  // never serialized as an empty or default declaration.
  const declaration = {
    ...Object.fromEntries(APP_INFO_DECLARATION_FIELDS.filter((key) => input.appInfo[key] !== undefined).map((key) => [key, input.appInfo[key]])),
    ...(input.desktop !== undefined ? { desktop: input.desktop } : {}),
  };
  const licenseBytes = readFileSync(input.licensePath);
  const manifestBytes = Buffer.from(canonicalJson(packageManifest));
  const declarationBytes = Buffer.from(stringifyYaml(declaration));
  if (manifestBytes.length > MAX_CONTROL_DOCUMENT_BYTES || declarationBytes.length > MAX_CONTROL_DOCUMENT_BYTES) {
    throw new Error('Control document exceeds 1 MiB');
  }
  const archiveEntries = [
    { name: 'LICENSE', bytes: licenseBytes, size: licenseBytes.length, mode: 0o644 },
    { name: 'manifest.json', bytes: manifestBytes, size: manifestBytes.length, mode: 0o644 },
    { name: 'nimi.app.yaml', bytes: declarationBytes, size: declarationBytes.length, mode: 0o644 },
    { name: 'app-info.json', bytes: infoBytes, size: infoBytes.length, mode: 0o644 },
    ...payloadEntries,
  ];
  validateCrossPlatformArchiveEntries(archiveEntries, input.target.os);
  const maxEntries = isManagedWeb ? MANAGED_WEB_MAX_RELEASE_ENTRIES : MAX_ZIP32_ENTRIES;
  const maxUncompressed = isManagedWeb ? MANAGED_WEB_MAX_RELEASE_BYTES : NATIVE_MAX_RELEASE_BYTES;
  const maxArchiveBytes = isManagedWeb ? MANAGED_WEB_MAX_ARCHIVE_BYTES : NATIVE_MAX_ARCHIVE_BYTES;
  if (archiveEntries.length > maxEntries) {
    throw new Error(`${isManagedWeb ? 'managed-web' : 'native'} package exceeds ${maxEntries} entries (${archiveEntries.length})`);
  }
  const totalUncompressedBytes = archiveEntries.reduce((sum, entry) => sum + entry.size, 0);
  if (totalUncompressedBytes > maxUncompressed) {
    throw new Error(`${isManagedWeb ? 'managed-web' : 'native'} package exceeds ${maxUncompressed} bytes uncompressed (${totalUncompressedBytes})`);
  }
  const outputDir = path.join(targetDir, OUTPUT_DIR);
  mkdirSync(outputDir, { recursive: true });
  const stem = `${input.appId}-${input.version}-${input.targetId}`;
  const artifactPath = path.join(outputDir, `${stem}.nimiapp`);
  const metadataPath = path.join(outputDir, `${stem}.target.json`);
  const appInfoPath = path.join(outputDir, `${stem}.app-info.json`);
  const written = await writeNimiAppArchiveToFile(artifactPath, archiveEntries, {
    compress: true,
    maxArchiveBytes,
    maxTotalUncompressedBytes: maxUncompressed,
    hashEntryName: input.runtimeEntry,
  });
  if (written.hashedEntrySha256 !== expectedRuntimeSha256) {
    await fsp.rm(artifactPath, { force: true }).catch(() => {});
    throw new Error('Production Runtime entry changed while writing archive');
  }
  writeFileSync(appInfoPath, infoBytes);
  const metadata = {
    format: TARGET_METADATA_FORMAT,
    app_id: input.appId,
    version: input.version,
    target_id: input.targetId,
    os: input.target.os,
    arch: input.target.arch,
    asset_name: path.basename(artifactPath),
    size: written.size,
    sha256: written.sha256,
    app_info: { asset_name: path.basename(appInfoPath), size: infoBytes.length, sha256: createHash('sha256').update(infoBytes).digest('hex') },
    runtime_entry: input.runtimeEntry,
    native_trust: packageManifest.native_trust,
    execution_profile: packageManifest.execution_profile,
  };
  writeFileSync(metadataPath, canonicalJson(metadata));
  return { ok: true, command: 'pack', dir: targetDir, artifactPath, metadataPath, appInfoPath, ...metadata };
}

export async function aggregateAppTargetCandidates(cwd, options = {}) {
  const targetDir = path.resolve(cwd, String(options.dir || '').trim() || '.');
  const buildProfile = readNativePackProfile(targetDir);
  const isManagedWebProfile = buildProfile.build_profile_ref === MANAGED_WEB_BUILD_PROFILE_REF;
  const outputDir = path.join(targetDir, OUTPUT_DIR);
  if (!existsSync(outputDir)) throw new Error('No target metadata exists to aggregate');
  const files = readdirSync(outputDir).filter((name) => name.endsWith('.target.json')).sort();
  if (files.length === 0) throw new Error('No target metadata exists to aggregate');
  const targets = files.map((name) => readJson(path.join(outputDir, name), name));
  const appId = targets[0].app_id;
  const version = targets[0].version;
  const seen = new Set();
  const parsedInfos = [];
  for (const target of targets) {
    const metadataLabel = `${target.target_id || 'unknown'} target metadata`;
    if (target.format !== TARGET_METADATA_FORMAT || target.app_id !== appId || target.version !== version) throw new Error('Target metadata cannot be aggregated across App releases');
    if (seen.has(target.target_id)) throw new Error(`Duplicate target metadata: ${target.target_id}`);
    seen.add(target.target_id);
    if (isManagedWebProfile && target.target_id !== 'desktop-universal') {
      throw new Error(`managed-web-pnpm-vite cannot aggregate non-universal target: ${target.target_id}`);
    }
    if (!isManagedWebProfile && target.target_id === 'desktop-universal') {
      throw new Error('Native build profile cannot aggregate desktop-universal target');
    }
    const expectedTarget = TARGETS[target.target_id];
    if (!expectedTarget || target.os !== expectedTarget.os || target.arch !== expectedTarget.arch) {
      throw new Error(`Target metadata identity is invalid: ${target.target_id}`);
    }
    const assetName = canonicalRelative(target.asset_name, `${metadataLabel}.asset_name`);
    if (assetName !== path.basename(assetName)) throw new Error(`Target asset_name must be a direct file name: ${assetName}`);
    const maxArchiveBytes = target.os === 'any' ? MANAGED_WEB_MAX_ARCHIVE_BYTES : NATIVE_MAX_ARCHIVE_BYTES;
    const maxUncompressed = target.os === 'any' ? MANAGED_WEB_MAX_RELEASE_BYTES : NATIVE_MAX_RELEASE_BYTES;
    if (!Number.isSafeInteger(target.size) || target.size <= 0 || target.size > maxArchiveBytes || !/^[a-f0-9]{64}$/u.test(target.sha256)) {
      throw new Error(`Target artifact size or SHA-256 is invalid: ${assetName}`);
    }
    const runtimeEntry = canonicalRelative(target.runtime_entry, `${metadataLabel}.runtime_entry`);
    if (!runtimeEntry.startsWith('payload/')) throw new Error(`Target runtime_entry must resolve inside payload: ${runtimeEntry}`);
    if (target.os === 'any' && runtimeEntry !== MANAGED_WEB_RUNTIME_ENTRY) {
      throw new Error(`Target managed-web runtime_entry must be ${MANAGED_WEB_RUNTIME_ENTRY}: ${runtimeEntry}`);
    }
    validateNativeExecutionFacts(target.native_trust, target.execution_profile, metadataLabel, target.os);
    const artifactPath = path.join(outputDir, assetName);
    if (!existsSync(artifactPath)) throw new Error(`Target artifact is missing: ${target.asset_name}`);

    let entries;
    const handle = await fsp.open(artifactPath, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== target.size || (await hashFileHandle(handle, stat.size)) !== target.sha256) {
        throw new Error(`Target artifact changed after pack: ${target.asset_name}`);
      }
      entries = await readNimiAppArchiveFromFile({ handle, size: stat.size }, {
        maxArchiveBytes,
        maxTotalUncompressedBytes: maxUncompressed,
        nimiappLayout: true,
        retainPredicate: (name) => NIMIAPP_CONTROL_LIMITS.has(name),
      });
    } finally {
      await handle.close();
    }

    const infoAsset = target.app_info;
    if (infoAsset?.asset_name !== `${appId}-${version}-${target.target_id}.app-info.json` || !Number.isSafeInteger(infoAsset.size) || infoAsset.size <= 0 || infoAsset.size > APP_INFO_MAX_BYTES) throw new Error(`Target App info reference is invalid: ${target.target_id}`);
    const infoPath = path.join(outputDir, infoAsset.asset_name);
    if (!existsSync(infoPath)) throw new Error(`Target App info asset is missing: ${infoAsset.asset_name}`);
    const infoBytes = readFileSync(infoPath);
    if (infoBytes.length !== infoAsset.size || createHash('sha256').update(infoBytes).digest('hex') !== infoAsset.sha256 || !entries.get('app-info.json')?.bytes?.equals(infoBytes)) throw new Error(`Target App info changed or differs from archive: ${target.target_id}`);
    const info = validateAppInfo(JSON.parse(infoBytes));
    if (info.app_id !== appId || info.version !== version || info.target_id !== target.target_id) throw new Error(`Target App info identity differs: ${target.target_id}`);
    if (target.os === 'any' && info.storage_policy?.kind !== 'nimi-mediated-default') {
      throw new Error(`Target managed-web package must use nimi-mediated-default storage: ${target.target_id}`);
    }
    parsedInfos.push({ targetId: target.target_id, info });
    validatePayloadLinks(entries, target.os);
    validateCrossPlatformArchiveEntries([...entries.entries()].map(([name, entry]) => ({ name, size: entry.size, mode: entry.mode })), target.os);
    const declarationEntry = entries.get('nimi.app.yaml');
    if (declarationEntry?.bytes) {
      const declarationYamlText = declarationEntry.bytes.toString('utf8');
      const archivedDeclaration = parseYaml(declarationYamlText);
      validateManifestDesktop(archivedDeclaration?.desktop, `${target.asset_name} nimi.app.yaml desktop`, declarationYamlText);
    }
    const manifest = readPackageManifestFromArchive(entries, metadataLabel);
    if (manifest.format !== PACKAGE_FORMAT) throw new Error(`Target archive manifest format is invalid: ${target.asset_name}`);
    for (const field of ['app_id', 'version', 'target_id', 'os', 'arch', 'runtime_entry', 'native_trust', 'execution_profile']) {
      if (!sameCanonicalValue(target[field], manifest[field])) {
        throw new Error(`Target metadata does not match archive manifest ${field}: ${target.asset_name}`);
      }
    }
    validateNativeExecutionFacts(manifest.native_trust, manifest.execution_profile, `${target.asset_name} archive manifest`, target.os);
    const runtimeEntryArchive = entries.get(runtimeEntry);
    if (target.os === 'any') {
      if (!runtimeEntryArchive || runtimeEntryArchive.mode !== 0o644) {
        throw new Error(`Target managed-web archive runtime_entry is missing or not 0644: ${runtimeEntry}`);
      }
      if (entries.size > MANAGED_WEB_MAX_RELEASE_ENTRIES) {
        throw new Error(`Target managed-web archive exceeds ${MANAGED_WEB_MAX_RELEASE_ENTRIES} entries: ${target.asset_name}`);
      }
      let totalUncompressedBytes = 0;
      for (const entry of entries.values()) totalUncompressedBytes += entry.size;
      if (totalUncompressedBytes > MANAGED_WEB_MAX_RELEASE_BYTES) {
        throw new Error(`Target managed-web archive exceeds ${MANAGED_WEB_MAX_RELEASE_BYTES} bytes uncompressed: ${target.asset_name}`);
      }
    } else if (!runtimeEntryArchive || runtimeEntryArchive.mode !== 0o755) {
      throw new Error(`Target archive runtime_entry is missing or non-executable: ${runtimeEntry}`);
    }
  }
  const firstInfo = parsedInfos[0].info;
  for (const entry of parsedInfos.slice(1)) {
    for (const field of ['display_name', 'summary', 'icon', 'readme_markdown', 'release_notes_markdown', 'safety_profile', 'storefront']) {
      if (!sameCanonicalValue(entry.info[field], firstInfo[field])) {
        throw new Error(`Target App info ${field} differs between ${parsedInfos[0].targetId} and ${entry.targetId}; one release shares one presentation`);
      }
    }
  }
  let storefrontMedia;
  if (firstInfo.storefront?.media !== undefined) {
    const repoManifest = readYaml(path.join(targetDir, 'nimi.app.yaml'), 'nimi.app.yaml');
    const { storefront: repoStorefront, mediaEntries } = readAppStorefront(targetDir, repoManifest);
    if (!sameCanonicalValue(repoStorefront?.media, firstInfo.storefront.media)) {
      throw new Error('Repository storefront media changed after target packing; rebuild targets and aggregate from the same commit');
    }
    const archiveEntries = [...mediaEntries.entries()]
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([name, bytes]) => ({ name, bytes, mode: 0o644 }));
    const mediaArchive = writeNimiAppArchive(archiveEntries, {
      compress: false,
      maxArchiveBytes: STOREFRONT_ARCHIVE_MAX_BYTES,
      maxTotalUncompressedBytes: STOREFRONT_ARCHIVE_MAX_BYTES,
    });
    if (mediaArchive.length > STOREFRONT_ARCHIVE_MAX_BYTES) {
      throw new Error(`Storefront media archive exceeds ${STOREFRONT_ARCHIVE_MAX_BYTES} bytes`);
    }
    const mediaAssetName = `${appId}-${version}-storefront-media.zip`;
    const mediaArchivePath = path.join(outputDir, mediaAssetName);
    writeAppArchiveFile(mediaArchivePath, mediaArchive);
    storefrontMedia = {
      asset_name: mediaAssetName,
      size: mediaArchive.length,
      sha256: hashAppArchive(mediaArchive),
    };
  }
  const candidate = {
    format: AGGREGATE_FORMAT,
    app_id: appId,
    version,
    ...(storefrontMedia ? { storefront_media: storefrontMedia } : {}),
    targets: targets.sort((left, right) => compareUtf8(left.target_id, right.target_id)),
  };
  const candidatePath = path.join(outputDir, `${appId}-${version}.candidate.json`);
  writeFileSync(candidatePath, canonicalJson(candidate));
  return {
    ok: true,
    command: 'pack',
    aggregate: true,
    dir: targetDir,
    candidatePath,
    ...(storefrontMedia ? { storefrontMediaPath: path.join(outputDir, storefrontMedia.asset_name) } : {}),
    ...candidate,
  };
}

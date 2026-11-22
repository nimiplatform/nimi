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
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { APP_INFO_DECLARATION_FIELDS, APP_INFO_MAX_BYTES, readAppInfo, readAppStorefront, validateAppInfo } from './app-info.mjs';
import { STOREFRONT_ARCHIVE_MAX_BYTES } from './storefront-media.mjs';
import { observeWindowsExecutableFacts } from './windows-powershell.mjs';
import { SYMBOLIC_LINK_MODE, validatePayloadLinks } from './payload-links.mjs';
import { observeMacOSExecutableFacts } from './macos-native.mjs';

const PACKAGE_FORMAT = 'nimi.app-package/v2';
const TARGET_METADATA_FORMAT = 'nimi.app-target-candidate/v1';
const AGGREGATE_FORMAT = 'nimi.app-release-candidate/v1';
const BUILD_PROFILE_PATH = '.nimi/config/build-profile.yaml';
const MANAGED_WEB_BUILD_PROFILE_REF = 'managed-web-pnpm-vite';
const MANAGED_WEB_EXECUTION_PROFILE_REF = 'nimi-managed-web-v1';
const MANAGED_WEB_RUNTIME_ENTRY = 'payload/index.html';
const MANAGED_WEB_MAX_RELEASE_BYTES = 64 * 1024 * 1024;
const MANAGED_WEB_MAX_RELEASE_ENTRIES = 10_000;
const MANAGED_WEB_MAX_DIRECTORY_DEPTH = 64;
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

function validateCrossPlatformArchiveEntries(entries, targetOS) {
  const roles = new Map();
  let fileCount = 0;
  for (const entry of entries) {
    const name = entry.name;
    const segments = name.split('/');
    if (targetOS === 'any' && segments.length - 1 > MANAGED_WEB_MAX_DIRECTORY_DEPTH) {
      throw new Error(`Managed-web directory depth exceeds ${MANAGED_WEB_MAX_DIRECTORY_DEPTH}: ${name}`);
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
    fileCount++;
    if (targetOS === 'any' && roles.size - fileCount > MANAGED_WEB_MAX_RELEASE_ENTRIES) {
      throw new Error(`Managed-web package exceeds ${MANAGED_WEB_MAX_RELEASE_ENTRIES} directories`);
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

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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
  if (typeof value !== 'string' || !value || value !== value.trim() || value.includes('\\')) {
    throw new Error(`${field} must be a canonical relative path`);
  }
  const parts = value.split('/');
  if (value.startsWith('/') || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${field} must be a canonical relative path`);
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
    return [{ relative: path.basename(payloadPath), bytes: readAppArchiveFile(payloadPath), mode: stat.mode & 0o111 ? 0o755 : 0o644 }];
  }
  if (!stat.isDirectory()) throw new Error('Pack payload must be a regular file or directory');
  const entries = [];
  const walk = (current, prefix = '') => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      const entryStat = lstatSync(absolute);
      if (entryStat.isSymbolicLink()) {
        if (os !== 'macos') throw new Error(`Pack payload must not contain symbolic links: ${relative}`);
        entries.push({ relative, bytes: Buffer.from(readlinkSync(absolute)), mode: SYMBOLIC_LINK_MODE });
      } else if (entryStat.isDirectory()) {
        walk(absolute, relative);
      } else if (entryStat.isFile()) {
        entries.push({ relative, bytes: readAppArchiveFile(absolute), mode: entryStat.mode & 0o111 ? 0o755 : 0o644 });
      } else {
        throw new Error(`Unsupported pack payload entry: ${relative}`);
      }
    }
  };
  walk(payloadPath);
  if (entries.length === 0) throw new Error('Pack payload must not be empty');
  return entries;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipEntryName(value) {
  const name = canonicalRelative(value, 'archive entry');
  if (Buffer.byteLength(name) > 0xffff) throw new Error(`Archive entry path is too long: ${name}`);
  return name;
}

export function writeNimiAppArchive(entries) {
  const normalized = entries.map((entry) => ({
    name: zipEntryName(entry.name),
    bytes: Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes),
    mode: entry.mode === SYMBOLIC_LINK_MODE ? SYMBOLIC_LINK_MODE : entry.mode === 0o755 ? 0o755 : 0o644,
  })).sort((left, right) => compareText(left.name, right.name));
  if (normalized.length === 0) throw new Error('nimiapp archive requires at least one file');
  if (new Set(normalized.map((entry) => entry.name)).size !== normalized.length) throw new Error('nimiapp archive entries must be unique');

  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of normalized) {
    if (entry.bytes.length > 0xffffffff) throw new Error(`Archive entry is too large: ${entry.name}`);
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.bytes.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.bytes.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(((entry.mode === SYMBOLIC_LINK_MODE ? entry.mode : 0o100000 | entry.mode) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.bytes.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(normalized.length, 8);
  end.writeUInt16LE(normalized.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}

export function readNimiAppArchive(bytes) {
  const archive = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (archive.length < 22 || archive.readUInt32LE(archive.length - 22) !== 0x06054b50) throw new Error('Invalid nimiapp ZIP end record');
  const endOffset = archive.length - 22;
  const count = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  if (centralOffset + centralSize !== endOffset || count !== archive.readUInt16LE(endOffset + 8)) throw new Error('Invalid nimiapp ZIP directory');
  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid nimiapp ZIP central entry');
    const method = archive.readUInt16LE(cursor + 10);
    const expectedCrc = archive.readUInt32LE(cursor + 16);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const unixMode = archive.readUInt32LE(cursor + 38) >>> 16;
    const fileType = unixMode & 0o170000;
    const specialBits = unixMode & 0o7000;
    let mode;
    if (unixMode === SYMBOLIC_LINK_MODE) {
      mode = SYMBOLIC_LINK_MODE;
    } else if ((fileType === 0o100000 || fileType === 0) && specialBits === 0) {
      mode = unixMode & 0o777;
    } else {
      throw new Error('Unsupported nimiapp ZIP entry mode');
    }
    if (method !== 0 || extraLength !== 0 || commentLength !== 0) throw new Error('Unsupported nimiapp ZIP entry encoding');
    if (mode !== 0o644 && mode !== 0o755 && mode !== SYMBOLIC_LINK_MODE) throw new Error('Unsupported nimiapp ZIP entry mode');
    const name = zipEntryName(archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'));
    if (entries.has(name) || archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid or duplicate nimiapp ZIP entry');
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const localName = archive.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8');
    if (localName !== name || localExtraLength !== 0 || archive.readUInt16LE(localOffset + 8) !== 0) {
      throw new Error('Invalid nimiapp ZIP local entry');
    }
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const payload = archive.subarray(dataOffset, dataOffset + size);
    if (payload.length !== size || crc32(payload) !== expectedCrc) throw new Error(`nimiapp ZIP entry digest mismatch: ${name}`);
    entries.set(name, Object.freeze({ bytes: Buffer.from(payload), mode }));
    cursor += 46 + nameLength;
  }
  if (cursor !== centralOffset + centralSize) throw new Error('Invalid nimiapp ZIP directory size');
  const names = [...entries.keys()];
  if (names.some((name, index) => index > 0 && compareText(names[index - 1], name) >= 0)) throw new Error('nimiapp ZIP entries are not canonical');
  return entries;
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
  if (!licenseStat.isFile() || licenseStat.isSymbolicLink() || licenseStat.size === 0) {
    throw new Error('App package LICENSE must be a non-empty direct regular file');
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

function observeProductionWindowsFacts(input, archivedRuntimeEntryBytes) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Production Windows pack must run on windows-x86_64');
  const observed = observeWindowsExecutableFacts(input.runtimeHostPath);
  const currentRuntimeEntryBytes = readFileSync(input.runtimeHostPath);
  if (!archivedRuntimeEntryBytes.equals(currentRuntimeEntryBytes)) {
    throw new Error('Production Runtime entry changed while native and execution facts were observed');
  }
  const nativeTrust = classifyWindowsNativeTrustObservation(observed.authenticode);
  return { nativeTrust, executionProfile: observed.execution_profile };
}

function resolveTargetFacts(input, production, archivedRuntimeEntryBytes) {
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
    if (!archivedRuntimeEntryBytes.equals(readFileSync(input.runtimeHostPath))) throw new Error('Production Runtime entry changed during macOS native observation');
    return facts;
  }
  return observeProductionWindowsFacts(input, archivedRuntimeEntryBytes);
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
  if (!entry) throw new Error(`${label} archive manifest.json is missing`);
  try {
    const manifest = JSON.parse(entry.bytes.toString('utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('root must be an object');
    return manifest;
  } catch (error) {
    throw new Error(`${label} archive manifest.json is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function packAppTarget(cwd, options = {}) {
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
    return { name, bytes: entry.bytes, mode };
  });
  validatePayloadLinks(new Map(payloadEntries.map((entry) => [entry.name, entry])), input.target.os);
  const runtimeEntry = payloadEntries.find((entry) => entry.name === input.runtimeEntry);
  if (!runtimeEntry) throw new Error(`runtime_entry is missing from target payload: ${input.runtimeEntry}`);
  const { nativeTrust, executionProfile } = resolveTargetFacts(input, options.production === true, runtimeEntry.bytes);
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
  const archiveEntries = [
    { name: 'LICENSE', bytes: readFileSync(input.licensePath), mode: 0o644 },
    { name: 'manifest.json', bytes: Buffer.from(canonicalJson(packageManifest)), mode: 0o644 },
    { name: 'nimi.app.yaml', bytes: Buffer.from(stringifyYaml(declaration)), mode: 0o644 },
    { name: 'app-info.json', bytes: infoBytes, mode: 0o644 },
    ...payloadEntries,
  ];
  validateCrossPlatformArchiveEntries(archiveEntries, input.target.os);
  if (isManagedWeb) {
    if (archiveEntries.length > MANAGED_WEB_MAX_RELEASE_ENTRIES) {
      throw new Error(`managed-web package exceeds ${MANAGED_WEB_MAX_RELEASE_ENTRIES} entries (${archiveEntries.length})`);
    }
    const totalUncompressedBytes = archiveEntries.reduce((sum, entry) => sum + entry.bytes.length, 0);
    if (totalUncompressedBytes > MANAGED_WEB_MAX_RELEASE_BYTES) {
      throw new Error(`managed-web package exceeds ${MANAGED_WEB_MAX_RELEASE_BYTES} bytes uncompressed (${totalUncompressedBytes})`);
    }
  }
  const archive = writeNimiAppArchive(archiveEntries);
  const sha256 = hashAppArchive(archive);
  const outputDir = path.join(targetDir, OUTPUT_DIR);
  mkdirSync(outputDir, { recursive: true });
  const stem = `${input.appId}-${input.version}-${input.targetId}`;
  const artifactPath = path.join(outputDir, `${stem}.nimiapp`);
  const metadataPath = path.join(outputDir, `${stem}.target.json`);
  const appInfoPath = path.join(outputDir, `${stem}.app-info.json`);
  writeAppArchiveFile(artifactPath, archive);
  writeFileSync(appInfoPath, infoBytes);
  const metadata = {
    format: TARGET_METADATA_FORMAT,
    app_id: input.appId,
    version: input.version,
    target_id: input.targetId,
    os: input.target.os,
    arch: input.target.arch,
    asset_name: path.basename(artifactPath),
    size: archive.length,
    sha256,
    app_info: { asset_name: path.basename(appInfoPath), size: infoBytes.length, sha256: createHash('sha256').update(infoBytes).digest('hex') },
    runtime_entry: input.runtimeEntry,
    native_trust: packageManifest.native_trust,
    execution_profile: packageManifest.execution_profile,
  };
  writeFileSync(metadataPath, canonicalJson(metadata));
  return { ok: true, command: 'pack', dir: targetDir, artifactPath, metadataPath, appInfoPath, ...metadata };
}

export function aggregateAppTargetCandidates(cwd, options = {}) {
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
      throw new Error(`Native build profile cannot aggregate desktop-universal target`);
    }
    const expectedTarget = TARGETS[target.target_id];
    if (!expectedTarget || target.os !== expectedTarget.os || target.arch !== expectedTarget.arch) {
      throw new Error(`Target metadata identity is invalid: ${target.target_id}`);
    }
    const assetName = canonicalRelative(target.asset_name, `${metadataLabel}.asset_name`);
    if (assetName !== path.basename(assetName)) throw new Error(`Target asset_name must be a direct file name: ${assetName}`);
    if (!Number.isSafeInteger(target.size) || target.size <= 0 || !/^[a-f0-9]{64}$/u.test(target.sha256)) {
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
    const bytes = readAppArchiveFile(artifactPath);
    if (bytes.length !== target.size || hashAppArchive(bytes) !== target.sha256) throw new Error(`Target artifact changed after pack: ${target.asset_name}`);
    const entries = readNimiAppArchive(bytes);
    const infoAsset = target.app_info;
    if (infoAsset?.asset_name !== `${appId}-${version}-${target.target_id}.app-info.json` || !Number.isSafeInteger(infoAsset.size) || infoAsset.size <= 0 || infoAsset.size > APP_INFO_MAX_BYTES) throw new Error(`Target App info reference is invalid: ${target.target_id}`);
    const infoPath = path.join(outputDir, infoAsset.asset_name);
    if (!existsSync(infoPath)) throw new Error(`Target App info asset is missing: ${infoAsset.asset_name}`);
    const infoBytes = readFileSync(infoPath);
    if (infoBytes.length !== infoAsset.size || createHash('sha256').update(infoBytes).digest('hex') !== infoAsset.sha256 || !entries.get('app-info.json')?.bytes.equals(infoBytes)) throw new Error(`Target App info changed or differs from archive: ${target.target_id}`);
    const info = validateAppInfo(JSON.parse(infoBytes));
    if (info.app_id !== appId || info.version !== version || info.target_id !== target.target_id) throw new Error(`Target App info identity differs: ${target.target_id}`);
    if (target.os === 'any' && info.storage_policy?.kind !== 'nimi-mediated-default') {
      throw new Error(`Target managed-web package must use nimi-mediated-default storage: ${target.target_id}`);
    }
    parsedInfos.push({ targetId: target.target_id, info });
    validatePayloadLinks(entries, target.os);
    validateCrossPlatformArchiveEntries([...entries.entries()].map(([name, entry]) => ({ name, bytes: entry.bytes, mode: entry.mode })), target.os);
    const declarationEntry = entries.get('nimi.app.yaml');
    if (declarationEntry) {
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
      for (const entry of entries.values()) totalUncompressedBytes += entry.bytes.length;
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
      .sort(([left], [right]) => compareText(left, right))
      .map(([name, bytes]) => ({ name, bytes, mode: 0o644 }));
    const mediaArchive = writeNimiAppArchive(archiveEntries);
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
    targets: targets.sort((left, right) => compareText(left.target_id, right.target_id)),
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

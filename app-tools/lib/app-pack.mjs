// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-009b
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-018a

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { windowsPowerShellEnv } from './windows-powershell.mjs';

const PACKAGE_FORMAT = 'nimi.app-package/v1';
const TARGET_METADATA_FORMAT = 'nimi.app-target-candidate/v1';
const AGGREGATE_FORMAT = 'nimi.app-release-candidate/v1';
const BUILD_PROFILE_PATH = '.nimi/config/build-profile.yaml';
const OUTPUT_DIR = 'dist/nimi-app';
const SEMVER_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u;
const TARGETS = Object.freeze({
  'windows-x86_64': Object.freeze({ os: 'windows', arch: 'x86_64' }),
});

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

function readCargoPackageVersion(source) {
  let inPackage = false;
  for (const line of source.split(/\r?\n/u)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
    if (header) {
      inPackage = header[1] === 'package';
      continue;
    }
    if (!inPackage) continue;
    const match = line.match(/^\s*version\s*=\s*"([^"]+)"\s*(?:#.*)?$/u);
    if (match) return match[1];
  }
  throw new Error('src-tauri/Cargo.toml [package] version is missing');
}

function collectPayload(payloadPath) {
  const stat = lstatSync(payloadPath);
  if (stat.isSymbolicLink()) throw new Error('Pack payload must not contain symbolic links');
  if (stat.isFile()) {
    return [{ relative: path.basename(payloadPath), bytes: readFileSync(payloadPath), mode: stat.mode & 0o111 ? 0o755 : 0o644 }];
  }
  if (!stat.isDirectory()) throw new Error('Pack payload must be a regular file or directory');
  const entries = [];
  const walk = (current, prefix = '') => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      const entryStat = lstatSync(absolute);
      if (entryStat.isSymbolicLink()) throw new Error(`Pack payload must not contain symbolic links: ${relative}`);
      if (entryStat.isDirectory()) {
        walk(absolute, relative);
      } else if (entryStat.isFile()) {
        entries.push({ relative, bytes: readFileSync(absolute), mode: entryStat.mode & 0o111 ? 0o755 : 0o644 });
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
    mode: entry.mode === 0o755 ? 0o755 : 0o644,
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
    central.writeUInt32LE(((0o100000 | entry.mode) << 16) >>> 0, 38);
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
    const mode = (archive.readUInt32LE(cursor + 38) >>> 16) & 0o777;
    if (method !== 0 || extraLength !== 0 || commentLength !== 0) throw new Error('Unsupported nimiapp ZIP entry encoding');
    if (mode !== 0o644 && mode !== 0o755) throw new Error('Unsupported nimiapp ZIP entry mode');
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

function readPackInputs(targetDir, targetId) {
  const target = TARGETS[targetId];
  if (!target) throw new Error(`Unsupported App package target: ${targetId}`);
  const packageJson = readJson(path.join(targetDir, 'package.json'), 'package.json');
  const licensePath = path.join(targetDir, 'LICENSE');
  if (!existsSync(licensePath)) throw new Error('App package LICENSE is missing');
  const licenseStat = lstatSync(licensePath);
  if (!licenseStat.isFile() || licenseStat.isSymbolicLink() || licenseStat.size === 0) {
    throw new Error('App package LICENSE must be a non-empty direct regular file');
  }
  const manifestPath = path.join(targetDir, 'nimi.app.yaml');
  const manifest = readYaml(manifestPath, 'nimi.app.yaml');
  const cargoPath = path.join(targetDir, 'src-tauri', 'Cargo.toml');
  if (!existsSync(cargoPath)) throw new Error('src-tauri/Cargo.toml is missing');
  const tauriConfig = readJson(path.join(targetDir, 'src-tauri', 'tauri.conf.json'), 'src-tauri/tauri.conf.json');
  const buildProfile = readYaml(path.join(targetDir, BUILD_PROFILE_PATH), BUILD_PROFILE_PATH);
  const appId = String(manifest.app_id || '');
  const version = String(packageJson.version || '');
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(appId)) throw new Error('nimi.app.yaml app_id must be canonical and dotted');
  if (
    !SEMVER_PATTERN.test(version)
    || manifest.version !== version
    || readCargoPackageVersion(readFileSync(cargoPath, 'utf8')) !== version
    || tauriConfig.version !== version
  ) {
    throw new Error('package.json, nimi.app.yaml, Cargo.toml, and tauri.conf.json versions must be exact and lockstep before pack');
  }
  const configured = buildProfile.targets?.[targetId];
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) throw new Error(`Build profile does not declare target: ${targetId}`);
  if (configured.os !== target.os || configured.arch !== target.arch) throw new Error(`Build profile target identity mismatch: ${targetId}`);
  const payload = resolveInside(targetDir, configured.payload_path, `targets.${targetId}.payload_path`);
  if (!existsSync(payload.resolved)) throw new Error(`Built target payload is missing: ${payload.normalized}`);
  const runtimeEntry = canonicalRelative(configured.runtime_entry, `targets.${targetId}.runtime_entry`);
  if (!runtimeEntry.startsWith('payload/')) throw new Error('runtime_entry must resolve inside the packaged payload');
  const payloadStat = lstatSync(payload.resolved);
  const runtimeRelative = runtimeEntry.slice('payload/'.length);
  const runtimeHostPath = payloadStat.isFile()
    ? payload.resolved
    : resolveInside(payload.resolved, runtimeRelative, `targets.${targetId}.runtime_entry`).resolved;
  return { target, targetId, targetDir, packageJson, licensePath, manifestPath, appId, version, payloadPath: payload.resolved, runtimeEntry, runtimeHostPath };
}

function requireCommand(result, label) {
  if (result.status !== 0) {
    const detail = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`);
  }
  return [result.stdout, result.stderr].filter(Boolean).join('\n');
}

function verifyWindowsNativeTrust(input) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Production Windows pack must run on windows-x86_64');
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:NIMI_APP_SIGN_TARGET; if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate) { Write-Error ('Authenticode status: ' + $signature.Status); exit 1 }; $signature.SignerCertificate.Subject",
  ], {
    encoding: 'utf8',
    env: windowsPowerShellEnv({ NIMI_APP_SIGN_TARGET: input.runtimeHostPath }),
  });
  const subject = requireCommand(result, 'Windows Authenticode verification').trim();
  if (!subject) throw new Error('Windows Authenticode verification returned no signer subject');
  return {
    posture: 'observed-valid-native-signature',
    windows_authenticode: 'valid',
    certificate_subject: subject,
  };
}

function resolveNativeTrust(input, production) {
  if (!production) return { posture: 'development-unsigned' };
  return verifyWindowsNativeTrust(input);
}

export function packAppTarget(cwd, options = {}) {
  const targetDir = path.resolve(cwd, String(options.dir || '').trim() || '.');
  const targetId = String(options.target || '').trim();
  if (!targetId) throw new Error('nimi-app pack requires --target');
  const input = readPackInputs(targetDir, targetId);
  const payloadEntries = collectPayload(input.payloadPath).map((entry) => {
    const name = `payload/${entry.relative.replaceAll('\\', '/')}`;
    return { name, bytes: entry.bytes, mode: name === input.runtimeEntry ? 0o755 : entry.mode };
  });
  if (!payloadEntries.some((entry) => entry.name === input.runtimeEntry)) throw new Error(`runtime_entry is missing from target payload: ${input.runtimeEntry}`);
  const nativeTrust = resolveNativeTrust(input, options.production === true);
  const packageManifest = {
    format: PACKAGE_FORMAT,
    app_id: input.appId,
    version: input.version,
    target_id: input.targetId,
    os: input.target.os,
    arch: input.target.arch,
    runtime_entry: input.runtimeEntry,
    native_trust: nativeTrust,
  };
  const archive = writeNimiAppArchive([
    { name: 'LICENSE', bytes: readFileSync(input.licensePath), mode: 0o644 },
    { name: 'manifest.json', bytes: canonicalJson(packageManifest), mode: 0o644 },
    { name: 'nimi.app.yaml', bytes: readFileSync(input.manifestPath), mode: 0o644 },
    ...payloadEntries,
  ]);
  const sha256 = createHash('sha256').update(archive).digest('hex');
  const outputDir = path.join(targetDir, OUTPUT_DIR);
  mkdirSync(outputDir, { recursive: true });
  const stem = `${input.appId}-${input.version}-${input.targetId}`;
  const artifactPath = path.join(outputDir, `${stem}.nimiapp`);
  const metadataPath = path.join(outputDir, `${stem}.target.json`);
  writeFileSync(artifactPath, archive);
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
    runtime_entry: input.runtimeEntry,
    native_trust: packageManifest.native_trust,
  };
  writeFileSync(metadataPath, canonicalJson(metadata));
  return { ok: true, command: 'pack', dir: targetDir, artifactPath, metadataPath, ...metadata };
}

export function aggregateAppTargetCandidates(cwd, options = {}) {
  const targetDir = path.resolve(cwd, String(options.dir || '').trim() || '.');
  const outputDir = path.join(targetDir, OUTPUT_DIR);
  if (!existsSync(outputDir)) throw new Error('No target metadata exists to aggregate');
  const files = readdirSync(outputDir).filter((name) => name.endsWith('.target.json')).sort();
  if (files.length === 0) throw new Error('No target metadata exists to aggregate');
  const targets = files.map((name) => readJson(path.join(outputDir, name), name));
  const appId = targets[0].app_id;
  const version = targets[0].version;
  const seen = new Set();
  for (const target of targets) {
    if (target.format !== TARGET_METADATA_FORMAT || target.app_id !== appId || target.version !== version) throw new Error('Target metadata cannot be aggregated across App releases');
    if (seen.has(target.target_id)) throw new Error(`Duplicate target metadata: ${target.target_id}`);
    seen.add(target.target_id);
    const artifactPath = path.join(outputDir, target.asset_name);
    if (!existsSync(artifactPath)) throw new Error(`Target artifact is missing: ${target.asset_name}`);
    const bytes = readFileSync(artifactPath);
    if (bytes.length !== target.size || createHash('sha256').update(bytes).digest('hex') !== target.sha256) throw new Error(`Target artifact changed after pack: ${target.asset_name}`);
  }
  const candidate = { format: AGGREGATE_FORMAT, app_id: appId, version, targets: targets.sort((left, right) => compareText(left.target_id, right.target_id)) };
  const candidatePath = path.join(outputDir, `${appId}-${version}.candidate.json`);
  writeFileSync(candidatePath, canonicalJson(candidate));
  return { ok: true, command: 'pack', aggregate: true, dir: targetDir, candidatePath, ...candidate };
}

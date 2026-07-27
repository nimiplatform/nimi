import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertSimulatorSourcePath, SimulatorConformanceError } from './simulator-manifest.mjs';

const SOURCE_DIGEST_DOMAIN = Buffer.from('nimi-simulator-source-v1\0', 'utf8');
const ACCEPTED_MODES = new Set(['100644', '100755']);
const LFS_POINTER_PREFIX = Buffer.from('version https://git-lfs.github.com/spec/v1\n', 'utf8');

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

export function sha256Digest(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map((key) => [key, sortObject(value[key])]),
  );
}

export function stableJson(value) {
  return JSON.stringify(sortObject(value));
}

export function stableJsonDigest(domain, value) {
  return sha256Digest(Buffer.concat([Buffer.from(`${domain}\0`, 'utf8'), Buffer.from(stableJson(value), 'utf8')]));
}

function assertFileEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    fail('SIM_SOURCE_ENTRY', 'source digest entry must be an object', `entries[${index}]`);
  }
  assertSimulatorSourcePath(entry.path, `entries[${index}].path`);
  if (!ACCEPTED_MODES.has(entry.mode)) {
    fail('SIM_SOURCE_MODE', `unsupported Git mode ${JSON.stringify(entry.mode)}`, `entries[${index}].mode`);
  }
  if (!Buffer.isBuffer(entry.bytes)) {
    fail('SIM_SOURCE_BYTES', 'source bytes must be a Buffer', `entries[${index}].bytes`);
  }
  if (entry.bytes.subarray(0, LFS_POINTER_PREFIX.length).equals(LFS_POINTER_PREFIX)) {
    fail('SIM_SOURCE_LFS_POINTER', 'unresolved Git LFS pointers are forbidden', entry.path);
  }
}

export function computeSourceDigestV1(entries) {
  if (!Array.isArray(entries)) {
    fail('SIM_SOURCE_ENTRIES', 'source digest input must be an array');
  }
  const normalized = entries.map((entry, index) => {
    assertFileEntry(entry, index);
    return {
      path: entry.path,
      pathBytes: Buffer.from(entry.path, 'utf8'),
      mode: entry.mode,
      bytes: entry.bytes,
    };
  });
  normalized.sort((left, right) => Buffer.compare(left.pathBytes, right.pathBytes));
  const pathSet = new Set();
  const folded = new Map();
  const hash = createHash('sha256');
  hash.update(SOURCE_DIGEST_DOMAIN);
  for (const entry of normalized) {
    if (pathSet.has(entry.path)) {
      fail('SIM_SOURCE_DUPLICATE_PATH', `duplicate source path ${JSON.stringify(entry.path)}`);
    }
    pathSet.add(entry.path);
    const foldedPath = entry.path.toLowerCase();
    const collision = folded.get(foldedPath);
    if (collision && collision !== entry.path) {
      fail('SIM_SOURCE_CASE_COLLISION', `case-fold collision between ${JSON.stringify(collision)} and ${JSON.stringify(entry.path)}`);
    }
    folded.set(foldedPath, entry.path);
    const pathLength = Buffer.allocUnsafe(4);
    pathLength.writeUInt32BE(entry.pathBytes.length);
    const fileLength = Buffer.allocUnsafe(8);
    fileLength.writeBigUInt64BE(BigInt(entry.bytes.length));
    hash.update(pathLength);
    hash.update(entry.pathBytes);
    hash.update(Buffer.from(entry.mode, 'ascii'));
    hash.update(fileLength);
    hash.update(entry.bytes);
  }
  return `sha256:${hash.digest('hex')}`;
}

function runGit(cwd, args, { allowFailure = false, encoding = null } = {}) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 && !allowFailure) {
    const detail = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr || '');
    fail('SIM_SOURCE_GIT', `git ${args[0]} failed: ${detail.trim() || `exit ${result.status}`}`);
  }
  return result;
}

function gitTrackedFiles(rootDir) {
  const probe = runGit(rootDir, ['rev-parse', '--show-toplevel'], { allowFailure: true, encoding: 'utf8' });
  if (probe.status !== 0) {
    return null;
  }
  const list = runGit(rootDir, ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.']);
  const stage = runGit(rootDir, ['ls-files', '--stage', '-z', '--', '.']);
  const deleted = new Set(
    runGit(rootDir, ['ls-files', '--deleted', '-z', '--', '.'])
      .stdout.toString('utf8').split('\0').filter(Boolean),
  );
  const stageModes = new Map();
  for (const record of stage.stdout.toString('utf8').split('\0')) {
    if (!record) continue;
    const match = record.match(/^(\d{6}) [0-9a-f]+ \d+\t([\s\S]+)$/);
    if (match) stageModes.set(match[2], match[1]);
  }
  const files = list.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((relativePath) => !deleted.has(relativePath))
    .map((relativePath) => ({ relativePath, indexMode: stageModes.get(relativePath) || null }));
  return files.length > 0 ? files : null;
}

function walkFilesystem(rootDir) {
  const files = [];
  const walk = (currentDir, relativeDir) => {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === '.git') {
        fail('SIM_SOURCE_NESTED_REPOSITORY', 'nested .git metadata is forbidden', relativeDir || '.');
      }
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isSymbolicLink()) {
        fail('SIM_SOURCE_SYMLINK', 'symbolic links are forbidden', relativePath);
      }
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push({ relativePath, indexMode: null });
      } else {
        fail('SIM_SOURCE_FILE_KIND', 'only regular files and directories are allowed', relativePath);
      }
    }
  };
  walk(rootDir, '');
  return files;
}

function assertContained(rootRealPath, absolutePath, relativePath) {
  const resolved = realpathSync(absolutePath);
  if (resolved !== rootRealPath && !resolved.startsWith(`${rootRealPath}${path.sep}`)) {
    fail('SIM_SOURCE_PATH_ESCAPE', 'source file realpath escapes the source root', relativePath);
  }
}

export function collectSimulatorSourceFiles(rootDir) {
  const absoluteRoot = path.resolve(rootDir);
  let rootStat;
  try {
    rootStat = statSync(absoluteRoot);
  } catch {
    fail('SIM_SOURCE_ROOT_MISSING', 'source root does not exist', absoluteRoot);
  }
  if (!rootStat.isDirectory()) {
    fail('SIM_SOURCE_ROOT_KIND', 'source root must be a directory', absoluteRoot);
  }
  const rootRealPath = realpathSync(absoluteRoot);
  const candidates = gitTrackedFiles(absoluteRoot) || walkFilesystem(absoluteRoot);
  const files = [];
  for (const candidate of candidates) {
    const normalized = candidate.relativePath.split(path.sep).join('/');
    assertSimulatorSourcePath(normalized, 'source.path');
    if (normalized !== normalized.normalize('NFC')) {
      fail('SIM_SOURCE_NON_NFC_PATH', 'source paths must be NFC-normalized', normalized);
    }
    const absolutePath = path.resolve(absoluteRoot, ...normalized.split('/'));
    if (!absolutePath.startsWith(`${absoluteRoot}${path.sep}`)) {
      fail('SIM_SOURCE_PATH_ESCAPE', 'source path escapes the source root', normalized);
    }
    let fileStat;
    try {
      fileStat = lstatSync(absolutePath);
    } catch {
      fail('SIM_SOURCE_FILE_MISSING', 'source inventory points to a missing file', normalized);
    }
    if (fileStat.isSymbolicLink()) {
      fail('SIM_SOURCE_SYMLINK', 'symbolic links are forbidden', normalized);
    }
    if (!fileStat.isFile()) {
      fail('SIM_SOURCE_FILE_KIND', 'source inventory entry must be a regular file', normalized);
    }
    assertContained(rootRealPath, absolutePath, normalized);
    if (candidate.indexMode && !ACCEPTED_MODES.has(candidate.indexMode)) {
      fail('SIM_SOURCE_MODE', `unsupported Git mode ${JSON.stringify(candidate.indexMode)}`, normalized);
    }
    const mode = candidate.indexMode ?? ((fileStat.mode & 0o111) === 0 ? '100644' : '100755');
    files.push({
      path: normalized,
      mode,
      bytes: readFileSync(absolutePath),
      absolutePath,
    });
  }
  files.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  computeSourceDigestV1(files);
  return files;
}

export function buildSimulatorSourceInventory(rootDir) {
  const files = collectSimulatorSourceFiles(rootDir);
  return {
    digest: computeSourceDigestV1(files),
    files,
  };
}

export const simulatorSourceInternals = Object.freeze({
  SOURCE_DIGEST_DOMAIN,
  LFS_POINTER_PREFIX,
  runGit,
});

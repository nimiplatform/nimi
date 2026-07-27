import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_HEAD_PATTERN = /^[0-9a-f]{40}$/u;

export const WINDOWS_RUNTIME_BUILD_SOURCE_PATHS = Object.freeze([
  'go.work',
  'go.work.sum',
  'nimi-cognition',
  'runtime',
  'scripts/build-runtime.mjs',
  'scripts/lib/runtime-build-record.mjs',
  'scripts/lib/windows-dev-signing.mjs',
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function git(repoRoot, args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function nulSeparatedGitPaths(repoRoot, args, pathspecs = []) {
  const commandArgs = [...args, '-z'];
  if (pathspecs.length > 0) commandArgs.push('--', ...pathspecs);
  return git(repoRoot, commandArgs, 'buffer')
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort();
}

function hashSourceTree(repoRoot, pathspecs = []) {
  const digest = createHash('sha256');
  const paths = nulSeparatedGitPaths(repoRoot, ['ls-files', '--cached', '--others', '--exclude-standard'], pathspecs);
  for (const relative of paths) {
    const absolute = path.join(repoRoot, relative);
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      digest.update(relative).update('\0deleted\0');
      continue;
    }
    digest.update(relative).update('\0');
    if (stat.isSymbolicLink()) {
      digest.update('symlink\0').update(fs.readlinkSync(absolute)).update('\0');
    } else if (stat.isFile()) {
      digest.update('file\0').update(String(stat.mode & 0o111)).update('\0').update(fs.readFileSync(absolute)).update('\0');
    } else if (stat.isDirectory()) {
      digest.update('directory\0');
    } else {
      throw new Error(`unsupported admitted source entry: ${relative}`);
    }
  }
  return digest.digest('hex');
}

function untrackedFileBindings(repoRoot, pathspecs = []) {
  return nulSeparatedGitPaths(repoRoot, ['ls-files', '--others', '--exclude-standard'], pathspecs).map((relative) => {
    const absolute = path.join(repoRoot, relative);
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      throw new Error(`untracked build source must be a file or symlink: ${relative}`);
    }
    return {
      path: relative.replaceAll('\\', '/'),
      sha256: stat.isSymbolicLink()
        ? sha256(`symlink\0${fs.readlinkSync(absolute)}`)
        : sha256(fs.readFileSync(absolute)),
    };
  });
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function fileSha256(file) {
  return sha256(fs.readFileSync(file));
}

export function captureRuntimeBuildSource(repoRoot, { pathspecs = [] } = {}) {
  const headCommit = git(repoRoot, ['rev-parse', 'HEAD']).trim();
  const branch = git(repoRoot, ['branch', '--show-current']).trim();
  const diffArgs = ['diff', '--binary', '--no-ext-diff', 'HEAD'];
  if (pathspecs.length > 0) diffArgs.push('--', ...pathspecs);
  const trackedDiff = git(repoRoot, diffArgs, 'buffer');
  const trackedDiffSha256 = sha256(trackedDiff);
  const untrackedFiles = untrackedFileBindings(repoRoot, pathspecs);
  const dirty = trackedDiff.length > 0 || untrackedFiles.length > 0;
  const sourceTreeSha256 = hashSourceTree(repoRoot, pathspecs);
  const descriptor = {
    repositoryId: 'nimi',
    headCommit,
    branch,
    dirty,
    trackedDiffSha256,
    untrackedFiles,
    sourceTreeSha256,
  };
  return Object.freeze({
    ...descriptor,
    dirtyDescriptorSha256: sha256(canonicalJson(descriptor)),
  });
}

export function assertRuntimeBuildSourceUnchanged(expected, repoRoot, { pathspecs = [] } = {}) {
  const actual = captureRuntimeBuildSource(repoRoot, { pathspecs });
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`repository source changed during Runtime candidate build: expected ${expected.dirtyDescriptorSha256}, observed ${actual.dirtyDescriptorSha256}`);
  }
  return actual;
}

export function createRuntimeBuildRecord({ source, runtimeBinarySha256, signerCertificateSha256, generatedAt = new Date().toISOString() }) {
  if (!GIT_HEAD_PATTERN.test(source?.headCommit || '')
      || !SHA256_PATTERN.test(source?.dirtyDescriptorSha256 || '')
      || !SHA256_PATTERN.test(source?.sourceTreeSha256 || '')
      || !SHA256_PATTERN.test(runtimeBinarySha256 || '')
      || !SHA256_PATTERN.test(signerCertificateSha256 || '')) {
    throw new Error('Runtime build record inputs are invalid');
  }
  const identity = {
    sourceDirtyDescriptorSha256: source.dirtyDescriptorSha256,
    sourceTreeSha256: source.sourceTreeSha256,
    runtimeBinarySha256,
    signerCertificateSha256,
  };
  return {
    schemaVersion: 1,
    artifactKind: 'nimi.windows-runtime-service-binary',
    generatedAt,
    candidateId: `runtime-${sha256(canonicalJson(identity)).slice(0, 32)}`,
    source,
    runtime: {
      binarySha256: runtimeBinarySha256,
      signerCertificateSha256,
    },
  };
}

export function validateRuntimeBuildRecord(record, { source, runtimeBinarySha256, signerCertificateSha256 } = {}) {
  const exact = (value, keys, location) => {
    const actual = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
    const expected = [...keys].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${location} has unexpected fields`);
    }
  };
  exact(record, ['schemaVersion', 'artifactKind', 'generatedAt', 'candidateId', 'source', 'runtime'], 'Runtime build record');
  exact(record.source, ['repositoryId', 'headCommit', 'branch', 'dirty', 'trackedDiffSha256', 'untrackedFiles', 'sourceTreeSha256', 'dirtyDescriptorSha256'], 'Runtime build source');
  exact(record.runtime, ['binarySha256', 'signerCertificateSha256'], 'Runtime build artifact');
  if (record.schemaVersion !== 1
      || record.artifactKind !== 'nimi.windows-runtime-service-binary'
      || !/^runtime-[0-9a-f]{32}$/u.test(record.candidateId || '')
      || !Number.isFinite(Date.parse(record.generatedAt || ''))
      || record.source.repositoryId !== 'nimi'
      || !GIT_HEAD_PATTERN.test(record.source.headCommit || '')
      || typeof record.source.dirty !== 'boolean'
      || !SHA256_PATTERN.test(record.source.trackedDiffSha256 || '')
      || !SHA256_PATTERN.test(record.source.sourceTreeSha256 || '')
      || !SHA256_PATTERN.test(record.source.dirtyDescriptorSha256 || '')
      || !Array.isArray(record.source.untrackedFiles)
      || !SHA256_PATTERN.test(record.runtime.binarySha256 || '')
      || !SHA256_PATTERN.test(record.runtime.signerCertificateSha256 || '')) {
    throw new Error('Runtime build record is invalid');
  }
  for (const [index, entry] of record.source.untrackedFiles.entries()) {
    exact(entry, ['path', 'sha256'], `Runtime build source untrackedFiles[${index}]`);
    if (!entry.path || path.isAbsolute(entry.path) || entry.path.includes('..') || !SHA256_PATTERN.test(entry.sha256 || '')) {
      throw new Error(`Runtime build source untrackedFiles[${index}] is invalid`);
    }
  }
  const descriptor = {
    repositoryId: record.source.repositoryId,
    headCommit: record.source.headCommit,
    branch: record.source.branch,
    dirty: record.source.dirty,
    trackedDiffSha256: record.source.trackedDiffSha256,
    untrackedFiles: record.source.untrackedFiles,
    sourceTreeSha256: record.source.sourceTreeSha256,
  };
  if (sha256(canonicalJson(descriptor)) !== record.source.dirtyDescriptorSha256) {
    throw new Error('Runtime build source dirty descriptor does not recompute');
  }
  const identity = {
    sourceDirtyDescriptorSha256: record.source.dirtyDescriptorSha256,
    sourceTreeSha256: record.source.sourceTreeSha256,
    runtimeBinarySha256: record.runtime.binarySha256,
    signerCertificateSha256: record.runtime.signerCertificateSha256,
  };
  if (record.candidateId !== `runtime-${sha256(canonicalJson(identity)).slice(0, 32)}`) {
    throw new Error('Runtime build candidate id does not recompute');
  }
  if (source && canonicalJson(record.source) !== canonicalJson(source)) throw new Error('Runtime build record source does not match the current repository');
  if (runtimeBinarySha256 && record.runtime.binarySha256 !== runtimeBinarySha256) throw new Error('Runtime build record binary hash mismatch');
  if (signerCertificateSha256 && record.runtime.signerCertificateSha256 !== signerCertificateSha256) throw new Error('Runtime build record signer mismatch');
  return record;
}

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertSimulatorSourcePath,
  computeSourceDigestV1,
  sha256Digest,
  SimulatorConformanceError,
} from '@nimiplatform/app-tools/simulator-conformance';

const ACCEPTED_MODES = new Set(['100644', '100755']);
const LFS_POINTER_PREFIX = Buffer.from('version https://git-lfs.github.com/spec/v1\n', 'utf8');

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

function runGit(repositoryPath, args, { allowFailure = false, encoding = null } = {}) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: repositoryPath,
    encoding,
    maxBuffer: 256 * 1024 * 1024,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
    },
  });
  if (result.status !== 0 && !allowFailure) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr || '');
    fail('SIM_MATERIALIZE_GIT', `git ${args[0]} failed: ${stderr.trim() || `exit ${result.status}`}`);
  }
  return result;
}

function resolveExternalRepository(source, repositoryCatalog, options) {
  const catalogRow = repositoryCatalog.repositories.find((entry) => entry.key === source.repository_key);
  if (!catalogRow) fail('SIM_REPOSITORY_UNKNOWN', `repository key ${JSON.stringify(source.repository_key)} is not in the Simulator catalog`);
  if (catalogRow.object_format !== source.object_format) {
    fail('SIM_REPOSITORY_OBJECT_FORMAT', 'descriptor and repository catalog object formats differ', source.repository_key);
  }
  const selectedUri = options.mirrorUri || catalogRow.canonical_fetch_uri;
  if (selectedUri !== catalogRow.canonical_fetch_uri && !catalogRow.allowed_mirrors.includes(selectedUri)) {
    fail('SIM_REPOSITORY_MIRROR', 'selected fetch URI is not the canonical URI or an allowed mirror', source.repository_key);
  }
  const parsed = new URL(selectedUri);
  if (parsed.protocol === 'file:') {
    return {
      repositoryPath: fileURLToPath(parsed),
      cleanup: null,
      fetchIdentity: selectedUri,
      canonicalFetchIdentity: catalogRow.canonical_fetch_uri,
    };
  }
  const cloneRoot = mkdtempSync(path.join(options.temporaryRoot || tmpdir(), 'nimi-simulator-git-'));
  const repositoryPath = path.join(cloneRoot, 'repository.git');
  const clone = spawnSync('git', [
    '-c', 'core.quotepath=false',
    '-c', 'credential.helper=',
    '-c', 'http.extraHeader=',
    '-c', 'protocol.allow=never',
    '-c', 'protocol.https.allow=always',
    'clone',
    '--bare',
    '--filter=blob:none',
    '--no-tags',
    selectedUri,
    repositoryPath,
  ], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
    },
  });
  if (clone.status !== 0) {
    rmSync(cloneRoot, { recursive: true, force: true });
    fail('SIM_REPOSITORY_FETCH', `credential-free repository fetch failed: ${String(clone.stderr || '').trim() || `exit ${clone.status}`}`);
  }
  return {
    repositoryPath,
    cleanup: () => rmSync(cloneRoot, { recursive: true, force: true }),
    fetchIdentity: selectedUri,
    canonicalFetchIdentity: catalogRow.canonical_fetch_uri,
  };
}

function resolveRepository(source, repositoryCatalog, options) {
  if (source.kind === 'workspace') {
    const expectedKey = options.workspaceRepositoryKey || 'nimi';
    if (source.repository_key !== expectedKey) {
      fail('SIM_WORKSPACE_REPOSITORY', `workspace source must use repository key ${JSON.stringify(expectedKey)}`);
    }
    return {
      repositoryPath: path.resolve(options.workspaceRoot),
      cleanup: null,
      fetchIdentity: `workspace:${source.repository_key}`,
      canonicalFetchIdentity: `workspace:${source.repository_key}`,
    };
  }
  return resolveExternalRepository(source, repositoryCatalog, options);
}

function assertGitObject(repositoryPath, source) {
  const actualFormat = runGit(repositoryPath, ['rev-parse', '--show-object-format'], { encoding: 'utf8' }).stdout.trim();
  const expectedFormat = source.object_format === 'git-sha1' ? 'sha1' : 'sha256';
  if (actualFormat !== expectedFormat) {
    fail('SIM_SOURCE_OBJECT_FORMAT', `repository uses ${actualFormat}, expected ${expectedFormat}`, source.repository_key);
  }
  const objectType = runGit(repositoryPath, ['cat-file', '-t', source.object_id], { encoding: 'utf8' }).stdout.trim();
  if (objectType !== 'commit') {
    fail('SIM_SOURCE_OBJECT_KIND', `selected object must directly identify a commit, got ${JSON.stringify(objectType)}`, source.object_id);
  }
  const resolvedObjectId = runGit(repositoryPath, ['rev-parse', '--verify', source.object_id], { encoding: 'utf8' }).stdout.trim();
  if (resolvedObjectId !== source.object_id) {
    fail('SIM_SOURCE_OBJECT_ID', 'selected object identity was abbreviated or changed during resolution', source.object_id);
  }
  return runGit(repositoryPath, ['rev-parse', `${source.object_id}^{tree}`], { encoding: 'utf8' }).stdout.trim();
}

function workspaceDirty(repositoryPath, sourceRoot) {
  const status = runGit(repositoryPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', sourceRoot]);
  return status.stdout.length > 0;
}

function readGitTree(repositoryPath, source) {
  const output = runGit(repositoryPath, [
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    source.object_id,
    '--',
    source.root,
  ]).stdout;
  const prefix = `${source.root}/`;
  const files = [];
  for (const record of output.toString('utf8').split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) fail('SIM_SOURCE_TREE_RECORD', 'invalid Git tree record');
    const header = record.slice(0, tab).split(' ');
    const fullPath = record.slice(tab + 1);
    if (header.length !== 3 || !fullPath.startsWith(prefix)) {
      fail('SIM_SOURCE_TREE_RECORD', `invalid Git tree row for ${JSON.stringify(fullPath)}`);
    }
    const [mode, type, objectId] = header;
    const relativePath = fullPath.slice(prefix.length);
    assertSimulatorSourcePath(relativePath, fullPath);
    if (relativePath !== relativePath.normalize('NFC')) {
      fail('SIM_SOURCE_NON_NFC_PATH', 'selected source path is not NFC-normalized', relativePath);
    }
    if (type === 'commit' || mode === '160000') {
      fail('SIM_SOURCE_SUBMODULE', 'Git submodules are forbidden', relativePath);
    }
    if (mode === '120000') {
      fail('SIM_SOURCE_SYMLINK', 'symbolic links are forbidden', relativePath);
    }
    if (type !== 'blob' || !ACCEPTED_MODES.has(mode)) {
      fail('SIM_SOURCE_MODE', `unsupported Git tree entry ${mode} ${type}`, relativePath);
    }
    const bytes = runGit(repositoryPath, ['cat-file', 'blob', objectId]).stdout;
    if (bytes.subarray(0, LFS_POINTER_PREFIX.length).equals(LFS_POINTER_PREFIX)) {
      fail('SIM_SOURCE_LFS_POINTER', 'unresolved Git LFS pointers are forbidden', relativePath);
    }
    files.push({ path: relativePath, mode, bytes, objectId });
  }
  if (files.length === 0) fail('SIM_SOURCE_EMPTY_ROOT', `selected root ${JSON.stringify(source.root)} contains no files`);
  return files;
}

function prepareTarget(targetRoot, stagingRoot) {
  const target = path.resolve(targetRoot);
  const staging = path.resolve(stagingRoot);
  if (target === staging || !target.startsWith(`${staging}${path.sep}`)) {
    fail('SIM_MATERIALIZE_TARGET', 'materialization target must be a child of the declared staging root');
  }
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  return target;
}

function writeMaterializedTree(files, targetRoot) {
  for (const file of files) {
    const target = path.join(targetRoot, ...file.path.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.bytes, { flag: 'wx' });
    chmodSync(target, file.mode === '100755' ? 0o755 : 0o644);
  }
}

export function materializeSourceLocation(source, repositoryCatalog, options) {
  if (!options?.workspaceRoot || !options?.stagingRoot || !options?.targetRoot) {
    fail('SIM_MATERIALIZE_OPTIONS', 'workspaceRoot, stagingRoot, and targetRoot are required');
  }
  const repository = resolveRepository(source, repositoryCatalog, options);
  try {
    const treeObjectId = assertGitObject(repository.repositoryPath, source);
    const dirty = source.kind === 'workspace' && workspaceDirty(repository.repositoryPath, source.root);
    if (dirty && options.release !== false) {
      fail('SIM_SOURCE_DIRTY_RELEASE', `workspace source ${JSON.stringify(source.root)} is dirty`);
    }
    const files = readGitTree(repository.repositoryPath, source);
    const digest = computeSourceDigestV1(files);
    if (digest !== source.expected_digest) {
      fail('SIM_SOURCE_DIGEST_MISMATCH', `expected ${source.expected_digest}, got ${digest}`, source.root);
    }
    const targetRoot = prepareTarget(options.targetRoot, options.stagingRoot);
    writeMaterializedTree(files, targetRoot);
    const fileInventory = files
      .map((file) => Object.freeze({
        path: file.path,
        mode: file.mode,
        bytes: file.bytes.length,
        digest: sha256Digest(file.bytes),
      }))
      .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
    return Object.freeze({
      sourceId: source.id,
      kind: source.kind,
      repositoryKey: source.repository_key,
      objectFormat: source.object_format,
      objectId: source.object_id,
      treeObjectId,
      root: `source/${options.moduleId}/${source.id}/`,
      sourceDigest: digest,
      authorityRefs: source.authority_refs,
      authorityIndexDigest: source.authority_index_digest,
      fetchIdentity: repository.fetchIdentity,
      canonicalFetchIdentity: repository.canonicalFetchIdentity,
      actualMirrorUsed: repository.fetchIdentity === repository.canonicalFetchIdentity ? null : repository.fetchIdentity,
      fileCount: files.length,
      files: Object.freeze(fileInventory),
      releasable: !dirty,
      dirtyWorkspace: dirty,
      sourceInstallScriptsExecuted: 0,
      sourceBuildScriptsExecuted: 0,
      targetRoot,
    });
  } finally {
    repository.cleanup?.();
  }
}

export function materializeDescriptor(descriptor, repositoryCatalog, options) {
  const moduleRoot = path.join(options.stagingRoot, 'source', descriptor.module_id);
  const rows = descriptor.sources.map((source) => materializeSourceLocation(source, repositoryCatalog, {
    ...options,
    moduleId: descriptor.module_id,
    targetRoot: path.join(moduleRoot, source.id),
  }));
  return Object.freeze({
    moduleId: descriptor.module_id,
    sourceLocations: rows,
    appRoot: rows.find((entry) => entry.sourceId === 'app')?.targetRoot,
  });
}

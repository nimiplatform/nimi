import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  assertExactObject,
  assertSchemaVersion,
  fail,
  readJsonFile,
} from './third-party-hardcut-evidence-core.mjs';

function runGit(repoPath, args) {
  const result = spawnSync('git', ['--no-optional-locks', '-C', repoPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    windowsHide: true,
  });
  if (result.status !== 0) {
    fail('REPOSITORY_PROBE_FAILED', 'trusted repository probe failed for requested git operation');
  }
  return result.stdout.trim();
}

function samePath(left, right) {
  const normalize = (value) => (
    process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value)
  );
  return normalize(left) === normalize(right);
}

function pathKey(value) {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function readIndexSnapshot(repoPath) {
  const reportedPath = runGit(
    repoPath,
    ['rev-parse', '--path-format=absolute', '--git-path', 'index'],
  );
  const indexPath = path.isAbsolute(reportedPath)
    ? reportedPath
    : path.resolve(repoPath, reportedPath);
  if (!fs.existsSync(indexPath)) return { exists: false };
  const before = fs.statSync(indexPath, { bigint: true });
  let descriptor;
  let opened;
  let bytes;
  let after;
  try {
    descriptor = fs.openSync(indexPath, fs.constants.O_RDONLY);
    opened = fs.fstatSync(descriptor, { bigint: true });
    bytes = fs.readFileSync(descriptor);
    after = fs.fstatSync(descriptor, { bigint: true });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  if (
    before.dev !== opened.dev
    || before.ino !== opened.ino
    || opened.dev !== after.dev
    || opened.ino !== after.ino
    || before.size !== after.size
    || before.mtimeNs !== after.mtimeNs
  ) {
    fail('REPOSITORY_STATE_CHANGED', 'Git index changed while it was inspected');
  }
  return {
    exists: true,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    mtimeNs: after.mtimeNs,
    size: after.size,
    dev: after.dev,
    ino: after.ino,
  };
}

function sameIndex(left, right) {
  return left.exists === right.exists
    && left.sha256 === right.sha256
    && left.mtimeNs === right.mtimeNs
    && left.size === right.size
    && left.dev === right.dev
    && left.ino === right.ino;
}

export function captureRepositoryState(repoPath) {
  const indexBeforeProbe = readIndexSnapshot(repoPath);
  const state = {
    path: repoPath,
    head: runGit(repoPath, ['rev-parse', 'HEAD']),
    branch: runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    status: runGit(repoPath, ['status', '--short']),
    index: null,
  };
  state.index = readIndexSnapshot(repoPath);
  if (!sameIndex(indexBeforeProbe, state.index)) {
    fail('REPOSITORY_STATE_CHANGED', 'trusted Git probe changed the repository index');
  }
  return state;
}

export function canonicalizeRepositoryInputs(trustedRepos) {
  const canonical = new Map();
  for (const [repoId, suppliedPath] of trustedRepos) {
    try {
      canonical.set(repoId, fs.realpathSync(suppliedPath));
    } catch {
      fail('REPOSITORY_PATH_INVALID', 'trusted repository path cannot be canonicalized');
    }
  }
  return canonical;
}

export function validateRepositoryBaseline(baselinePath, trustedRepos, contract, packetRoot) {
  const baseline = readJsonFile(baselinePath, 'execution baseline');
  assertExactObject(
    baseline,
    contract.object_schemas.execution_baseline.required_fields,
    'execution baseline',
  );
  assertSchemaVersion(baseline, contract.version, 'execution baseline');
  if (!Array.isArray(baseline.repositories) || baseline.repositories.length === 0) {
    fail('CLEAN_PREFLIGHT_MISSING', 'execution baseline must include a trusted repository preflight');
  }
  const repositoryIds = baseline.repositories.map((repository) => repository.id);
  if (repositoryIds.some((repoId) => (
    typeof repoId !== 'string' || !/^[a-z][a-z0-9._-]*$/u.test(repoId)
  ))) {
    fail('INVALID_FIELD', 'execution baseline contains an invalid repository ID');
  }
  if (repositoryIds.length !== new Set(repositoryIds).size) {
    fail('DUPLICATE_REPOSITORY', 'execution baseline contains duplicate repository IDs');
  }
  for (const repoId of trustedRepos.keys()) {
    if (!repositoryIds.includes(repoId)) {
      fail('UNKNOWN_REPOSITORY_PROBE', 'trusted CLI input includes an unknown repository ID');
    }
  }
  let canonicalPacketRoot;
  try {
    canonicalPacketRoot = fs.realpathSync(packetRoot);
  } catch {
    fail('REPOSITORY_PATH_INVALID', 'packet or repository path cannot be canonicalized');
  }
  const primaryRepository = baseline.repositories.find((repository) => (
    repository.id === contract.repository_policy.primary_repository_id
  ));
  if (!primaryRepository || primaryRepository.branch !== contract.repository_policy.primary_branch) {
    fail('CLEAN_PREFLIGHT_MISSING', 'execution baseline must include clean primary develop preflight');
  }
  const canonicalRepositoryPaths = new Set();
  const canonicalRepositories = new Map();
  const repositoryStates = new Map();
  for (const repository of baseline.repositories ?? []) {
    assertExactObject(
      repository,
      contract.object_schemas.repository_preflight.required_fields,
      `repository preflight ${repository.id ?? '<unknown>'}`,
    );
    if (
      typeof repository.id !== 'string'
      || !/^[a-z][a-z0-9._-]*$/u.test(repository.id)
      || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(repository.head ?? '')
      || typeof repository.branch !== 'string'
      || repository.branch.length === 0
      || Number.isNaN(Date.parse(repository.observed_at))
    ) {
      fail('INVALID_FIELD', 'repository preflight has invalid identity, HEAD, branch, or timestamp');
    }
    if (
      repository.clean !== true
      || repository.status_porcelain !== ''
      || repository.preflight_command !== 'git status --short'
    ) {
      fail(
        'CLEAN_PREFLIGHT_MISSING',
        `repository ${repository.id} does not record an empty clean execution preflight`,
      );
    }
    const suppliedPath = trustedRepos.get(repository.id);
    if (!suppliedPath) {
      fail('REPOSITORY_PROBE_MISSING', `no trusted --repo probe supplied for ${repository.id}`);
    }
    let trustedPath;
    try {
      trustedPath = fs.realpathSync(suppliedPath);
    } catch {
      fail('REPOSITORY_PATH_INVALID', 'trusted repository path cannot be canonicalized');
    }
    if (canonicalRepositoryPaths.has(pathKey(trustedPath))) {
      fail('DUPLICATE_REPOSITORY_PATH', 'multiple repository IDs resolve to one trusted path');
    }
    canonicalRepositoryPaths.add(pathKey(trustedPath));
    canonicalRepositories.set(repository.id, trustedPath);
    if (samePath(canonicalPacketRoot, trustedPath) || isInside(canonicalPacketRoot, trustedPath)) {
      fail('REPOSITORY_PATH_INVALID', 'trusted repository path must be outside the packet');
    }
    const gitTopLevel = runGit(trustedPath, ['rev-parse', '--show-toplevel']);
    let canonicalTopLevel;
    try {
      canonicalTopLevel = fs.realpathSync(gitTopLevel);
    } catch {
      fail('REPOSITORY_PATH_INVALID', 'Git top-level path cannot be canonicalized');
    }
    if (!samePath(trustedPath, canonicalTopLevel)) {
      fail('REPOSITORY_PATH_INVALID', 'trusted repository path must equal Git top-level');
    }
    const state = captureRepositoryState(trustedPath);
    if (repository.head !== state.head) {
      fail(
        'REPOSITORY_HEAD_MISMATCH',
        `recorded HEAD for ${repository.id} does not match the trusted repository probe`,
      );
    }
    if (repository.branch !== state.branch) {
      fail(
        'REPOSITORY_HEAD_MISMATCH',
        `recorded branch for ${repository.id} does not match the trusted repository probe`,
      );
    }
    if (state.status !== '') {
      fail('CLEAN_PREFLIGHT_MISMATCH', `trusted repository ${repository.id} is not clean`);
    }
    repositoryStates.set(repository.id, state);
  }
  return { baseline, canonicalRepositories, repositoryStates };
}

export function assertRepositoryStateStable(repositoryStates) {
  for (const state of repositoryStates.values()) {
    const current = captureRepositoryState(state.path);
    if (
      current.head !== state.head
      || current.branch !== state.branch
      || current.status !== state.status
      || !sameIndex(current.index, state.index)
    ) {
      fail('REPOSITORY_STATE_CHANGED', 'trusted repository changed during packet validation');
    }
  }
}

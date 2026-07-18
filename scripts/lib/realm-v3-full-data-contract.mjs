import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  realpath,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import {
  validateLiveEnvironmentAttestationBinding,
  validateLiveEnvironmentCleanupReceipt,
  validateLiveEnvironmentExecutionReceipt,
} from './realm-v3-full-data-live-environment.mjs';

export const FULL_DATA_DENOMINATOR = 471;
export const WORLD_CHARACTER_DENOMINATOR = 470;
export const PERSONA_CHARACTER_DENOMINATOR = 1;
export const FULL_DATA_STAGES = Object.freeze([
  'preflight',
  'captured-replay',
  'live-materialize',
  'restart-offline',
  'close',
]);
export const PARTITION_STAGES = Object.freeze([
  'captured-replay',
  'live-materialize',
  'restart-offline',
]);
export const SOURCE_LANES = Object.freeze([
  'source_identity',
  'source_behavior',
  'world_context',
  'relationship_context',
  'source_knowledge',
]);

const RUN_LOCK_SCHEMA = 'nimi.realm-v3-full-data-run-lock/v1';
const MANIFEST_SCHEMA = 'nimi.realm-v3-full-data-partition-manifest/v1';
const RECEIPT_SCHEMA = 'nimi.realm-v3-full-data-partition-receipt/v1';
const STAGE_REPORT_SCHEMA = 'nimi.realm-v3-full-data-stage-report/v1';
const AGGREGATE_SCHEMA = 'nimi.realm-v3-full-data-aggregate/v1';
const CLOSE_CANDIDATE_SCHEMA = 'nimi.realm-v3-full-data-close-candidate/v1';
const CAPTURE_INDEX_SCHEMA = 'realm.fullchain-packet-capture-index/v2';
const SOURCE_CENSUS_SCHEMA = 'nimi.realm-v3-full-data-source-census/v1';
const RUNTIME_ROOT_MARKER_SCHEMA = 'nimi.realm-v3-full-data-runtime-root/v1';
const RUNTIME_CLEANUP_SCHEMA = 'nimi.realm-v3-full-data-runtime-cleanup/v1';
const PACKET_SCHEMA = 'realm.source-materialization-packet/v3';
const SNAPSHOT_SCHEMA = 'nimi.runtime.local-agent-source-snapshot/v2';
const ACCESS_POLICY_VERSION = 'realm.source-materialization-access-policy/v5';
const FIRST_PARTY_AUTHORITY_CLASS = 'authenticated_first_party_product_operation';
const PACKET_OPERATION = Object.freeze({
  operationId: 'WorldCoreController_createSourceMaterializationPacket',
  method: 'post',
  path: '/api/realm/core/source-materialization-packets',
});
const AUTHORIZATION_INPUTS = Object.freeze([
  'authenticated_realm_account',
  'canonical_source_and_world_materialization_visibility',
  'exact_CharacterSourceRefV3',
  'materialization_readiness',
  'runtime_challenge_audience_limits_and_proof_boundary',
]);
const FORBIDDEN_AUTHORIZATION_INPUTS = Object.freeze([
  'app_id',
  'permission_scope',
  'access_grant_id',
  'synthetic_grant_decision',
]);
const RETIRED_AUTHORIZATION_IDENTIFIERS = Object.freeze([
  'realm_source.snapshot.consume',
  'realm_source.snapshot.bind',
  'agent.identity.project',
]);
const RETIRED_AUTHORIZATION_ENDPOINTS = Object.freeze([
  '/api/human/me/permission-grants',
  '/api/runtime/realm-grants/issue',
]);
const AUTHORIZATION_BOUNDARY = Object.freeze({
  authorityClass: FIRST_PARTY_AUTHORITY_CLASS,
  authenticatedRealmAccountRequired: true,
  canonicalSourceVisibilityRequired: true,
  thirdPartyAppPermissionRequired: false,
  permissionCatalog: 'empty',
  forbiddenInputs: FORBIDDEN_AUTHORIZATION_INPUTS,
});
const FIXED_PERSONA_SOURCE = Object.freeze({
  kind: 'personaCharacter',
  id: 'persona-character-0716-fullchain-fixture',
  worldId: 'cbdb-yuan-literati-academy-world',
  ownerAccountId: '01J00000000000000000000000',
  sourceHash: '5f00937ee6d7ac325c77d5c07a0b6c30d2ee0380fa15a8761dda4528562ed3d1',
});
const PROGRESS_INTERVAL_MS = 10 * 60 * 1000;
const SHA256_RE = /^[0-9a-f]{64}$/;
const GIT_OBJECT_RE = /^[0-9a-f]{40}$/;
const REASON_RE = /^[a-z][a-z0-9_]{1,95}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,511}$/;
const RUNTIME_DATA_ROOT_RE = /^realm-v3-full-data-runtime-[0-9a-f]{16,64}$/u;
const IS_WINDOWS = process.platform === 'win32';
const HAS_POSIX_PERMISSION_BITS = !IS_WINDOWS && typeof process.getuid === 'function';
const CANONICAL_NODE_DIRECTORY = path.dirname(realpathSync(process.execPath));
const CANONICAL_GIT_EXECUTABLE = (() => {
  if (!IS_WINDOWS) return '/usr/bin/git';
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const whereExecutable = path.join(systemRoot, 'System32', 'where.exe');
  const [candidate] = execFileSync(whereExecutable, ['git'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
  if (!candidate) fail('git_unavailable', 'Git executable is unavailable');
  return realpathSync(candidate);
})();
const CLOSED_EXECUTION_PATH = [
  CANONICAL_NODE_DIRECTORY,
  path.dirname(CANONICAL_GIT_EXECUTABLE),
  ...(!IS_WINDOWS ? ['/usr/bin', '/bin', '/usr/sbin', '/sbin'] : []),
].join(path.delimiter);

const CONTRACT_EXACT_PATHS = Object.freeze([
  'config/realm-contract-lock.yaml',
  'config/realm-openapi/api-nimi.yaml',
  'config/realm-v3/current-producer-admission.json',
  'config/realm-v3/handoff-dispositions.json',
  'proto/runtime/v1/agent_service.proto',
  'proto/runtime/v1/agent_source_materialization.proto',
  'runtime/internal/services/runtimeagent/realm_source_materialization_full_data_worker_test.go',
  'scripts/lib/realm-v3-full-data-close.mjs',
  'scripts/lib/realm-v3-full-data-contract.mjs',
  'scripts/lib/realm-v3-full-data-execution.mjs',
  'scripts/lib/realm-v3-full-data-live-cleanup.mjs',
  'scripts/lib/realm-v3-full-data-live-contract.mjs',
  'scripts/lib/realm-v3-full-data-live-attestation.mjs',
  'scripts/lib/realm-v3-full-data-live-environment.mjs',
  'scripts/lib/realm-v3-full-data-live-infrastructure.mjs',
  'scripts/lib/realm-v3-full-data-live-prepare.mjs',
  'scripts/lib/realm-v3-full-data-live-services.mjs',
  'scripts/lib/realm-v3-full-data-manifest.mjs',
  'scripts/lib/realm-v3-full-data-preflight.mjs',
  'scripts/lib/realm-v3-full-data-run-lock.mjs',
  'scripts/lib/realm-v3-full-data-runner.mjs',
  'scripts/realm-v3-full-data-census-worker.mjs',
  'scripts/realm-v3-full-data-live-environment.mjs',
  'scripts/test-realm-v3-full-data.mjs',
  'sdks/typescript/index.ts',
  'sdks/typescript/runtime/index.ts',
  'sdks/typescript/runtime/runtime-agent-materialization.ts',
]);

const CONTRACT_PATH_PATTERNS = Object.freeze([
  /^runtime\/internal\/realmsourcecontract\/.*\.go$/,
  /^runtime\/internal\/services\/runtimeagent\/source_materialization_v3.*\.go$/,
  /^runtime\/internal\/services\/runtimeagent\/realm_source_materialization.*\.go$/,
  /^runtime\/internal\/services\/runtimeagent\/realm_source_snapshot_v2.*\.go$/,
  /^runtime\/internal\/services\/runtimeagent\/agent_turn_context_(?:source_compiler_v3|hash|budget|lanes|types).*\.go$/,
]);

export class FullDataContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FullDataContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new FullDataContractError(code, message);
}

export function canonicalJSONStringify(value) {
  const normalize = (candidate, pointer) => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') {
      return candidate;
    }
    if (typeof candidate === 'number') {
      if (!Number.isSafeInteger(candidate)) {
        fail('unsafe_number', `${pointer} must be a safe integer`);
      }
      return candidate;
    }
    if (Array.isArray(candidate)) {
      return candidate.map((entry, index) => normalize(entry, `${pointer}/${index}`));
    }
    if (typeof candidate === 'object' && candidate !== undefined) {
      const result = {};
      for (const key of Object.keys(candidate).sort()) {
        if (candidate[key] === undefined) {
          fail('undefined_value', `${pointer}/${key} is undefined`);
        }
        result[key] = normalize(candidate[key], `${pointer}/${key}`);
      }
      return result;
    }
    fail('non_json_value', `${pointer} is not canonical JSON data`);
  };
  return JSON.stringify(normalize(value, '$'));
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function domainHash(domain, value) {
  return sha256Hex(`${domain}\0${canonicalJSONStringify(value)}`);
}

function assertClosedObject(value, required, optional, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid_object', `${label} must be an object`);
  }
  const admitted = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!admitted.has(key)) {
      fail('unknown_field', `${label}.${key} is not admitted`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail('missing_field', `${label}.${key} is required`);
    }
  }
  return value;
}

function assertString(value, label, pattern = SAFE_ID_RE) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('invalid_string', `${label} is invalid`);
  }
  return value;
}

function assertSHA256(value, label) {
  return assertString(value, label, SHA256_RE);
}

function assertGitObject(value, label) {
  return assertString(value, label, GIT_OBJECT_RE);
}

function assertCount(value, label, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    fail('invalid_count', `${label} must be a ${positive ? 'positive' : 'non-negative'} safe integer`);
  }
  return value;
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJSONStringify(actual) !== canonicalJSONStringify(wanted)) {
    fail('key_set_mismatch', `${label} keys are not exact`);
  }
}

function assertEqual(actual, expected, code, label) {
  if (canonicalJSONStringify(actual) !== canonicalJSONStringify(expected)) {
    fail(code, `${label} does not match the frozen run input`);
  }
}

async function sha256File(filePath) {
  return sha256Hex(await readFile(filePath));
}

async function writeJSONAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const body = `${canonicalJSONStringify(value)}\n`;
  let committed = false;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(body, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, filePath);
    await chmod(filePath, 0o600);
    if (!IS_WINDOWS) {
      const committedHandle = await open(filePath, 'r');
      try {
        await committedHandle.sync();
      } finally {
        await committedHandle.close();
      }
    }
    await syncDirectory(path.dirname(filePath));
    committed = true;
  } finally {
    if (!committed) await rm(temporary, { force: true }).catch(() => {});
  }
}

async function syncDirectory(directory) {
  // Win32 does not support opening a directory as a file handle for fsync.
  // The file itself is synced before the atomic rename; POSIX additionally
  // syncs the parent directory to make the directory entry durable.
  if (IS_WINDOWS) return;
  const directoryHandle = await open(directory, 'r');
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

async function readJSON(filePath, label) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    fail('missing_evidence', `${label} is unavailable: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail('invalid_evidence_json', `${label} is invalid JSON: ${error.message}`);
  }
}

async function loadOptionalPrivateEvidenceArtifact(filePath, label) {
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (HAS_POSIX_PERMISSION_BITS && (info.mode & 0o077) !== 0) ||
    (HAS_POSIX_PERMISSION_BITS && info.uid !== process.getuid())
  ) {
    fail('invalid_evidence_path', `${label} must be a current-user private regular file`);
  }
  return readJSON(filePath, label);
}

function closedExecutionEnvironment(extra = {}) {
  return {
    PATH: CLOSED_EXECUTION_PATH,
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    ...extra,
  };
}

function assertNoAmbientNodeInjection() {
  for (const key of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'LD_PRELOAD',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_LIBRARY_PATH',
    'DYLD_FRAMEWORK_PATH',
  ]) {
    if (Object.hasOwn(process.env, key) && process.env[key] !== '') {
      fail('ambient_execution_injection', `full-data runner refuses ambient ${key}`);
    }
  }
}

function git(nimiRoot, args) {
  return execFileSync(CANONICAL_GIT_EXECUTABLE, ['-C', nimiRoot, ...args], {
    encoding: 'utf8',
    env: closedExecutionEnvironment({
      HOME: '/var/empty',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitBuffer(nimiRoot, args) {
  return execFileSync(CANONICAL_GIT_EXECUTABLE, ['-C', nimiRoot, ...args], {
    env: closedExecutionEnvironment({
      HOME: '/var/empty',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function hashLengthFramed(...values) {
  const digest = createHash('sha256');
  for (const raw of values) {
    const value = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
    const length = Buffer.allocUnsafe(8);
    length.writeBigUInt64BE(BigInt(value.length));
    digest.update(length);
    digest.update(value);
  }
  return digest.digest('hex');
}

async function hashUntrackedFiles(nimiRoot, listBuffer) {
  const paths = listBuffer.toString('utf8').split('\0').filter(Boolean);
  const digest = createHash('sha256');
  for (const relativePath of paths) {
    const absolutePath = path.join(nimiRoot, relativePath);
    const metadata = await lstat(absolutePath);
    let body;
    if (metadata.isSymbolicLink()) body = Buffer.from(await readlink(absolutePath));
    else if (metadata.isFile()) body = await readFile(absolutePath);
    else fail('invalid_candidate_input', `untracked candidate input ${relativePath} is not a file`);
    digest.update(Buffer.from(`${relativePath}\0${metadata.mode.toString(8)}\0${body.length}\0`));
    digest.update(body);
  }
  return { count: paths.length, digest: digest.digest('hex') };
}

function canonicalPathThroughExistingAncestor(candidate, label) {
  let cursor = path.resolve(candidate);
  const suffix = [];
  while (true) {
    try {
      return path.join(realpathSync(cursor), ...suffix);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        fail('unsafe_path', `${label} cannot be canonicalized: ${error.message}`);
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        fail('unsafe_path', `${label} has no existing canonical ancestor`);
      }
      suffix.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

function validateEvidenceDirectory(nimiRoot, evidenceDir) {
  const resolvedRoot = realpathSync(path.resolve(nimiRoot));
  const resolved = path.resolve(evidenceDir);
  if (!path.isAbsolute(evidenceDir)) {
    fail('unsafe_evidence_path', 'evidence-dir must be absolute');
  }
  const canonical = canonicalPathThroughExistingAncestor(resolved, 'evidence-dir');
  if (canonical !== resolved) {
    fail('unsafe_evidence_path', 'evidence-dir must not traverse a symlink');
  }
  const admitted = [
    path.join(resolvedRoot, '.local'),
    path.join(resolvedRoot, '.nimi', 'local'),
  ];
  if (!admitted.some((root) => canonical.startsWith(`${root}${path.sep}`))) {
    fail('unsafe_evidence_path', 'evidence-dir must be below Nimi .local or .nimi/local');
  }
  return canonical;
}

async function ensurePrivateEvidenceDirectory(evidenceDir) {
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  const info = await lstat(evidenceDir);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('unsafe_evidence_path', 'evidence-dir must be a regular directory');
  }
  if (HAS_POSIX_PERMISSION_BITS && info.uid !== process.getuid()) {
    fail('unsafe_evidence_path', 'evidence-dir is not owned by the current user');
  }
  if (HAS_POSIX_PERMISSION_BITS && (info.mode & 0o077) !== 0) {
    fail('unsafe_evidence_path', 'evidence-dir permits group or other access');
  }
  if ((await realpath(evidenceDir)) !== path.resolve(evidenceDir)) {
    fail('unsafe_evidence_path', 'evidence-dir traverses a symlink');
  }
}

function validateRuntimeDataRoot(nimiRoot, runtimeDataRoot, required) {
  if (!runtimeDataRoot) {
    if (required) {
      fail('missing_runtime_data_root', 'runtime-data-root is required for this stage');
    }
    return null;
  }
  if (!path.isAbsolute(runtimeDataRoot)) {
    fail('unsafe_runtime_data_root', 'runtime-data-root must be absolute');
  }
  const resolved = path.resolve(runtimeDataRoot);
  let canonicalParent;
  try {
    canonicalParent = realpathSync(path.dirname(resolved));
  } catch (error) {
    fail('unsafe_runtime_data_root', `runtime-data-root parent is unavailable: ${error.message}`);
  }
  const canonical = path.join(canonicalParent, path.basename(resolved));
  const home = realpathSync(homedir());
  const repo = realpathSync(path.resolve(nimiRoot));
  const temporaryRoot = realpathSync(tmpdir());
  if (
    canonical === path.parse(canonical).root ||
    canonical === home ||
    canonical === repo ||
    canonical.startsWith(`${repo}${path.sep}`) ||
    !canonical.startsWith(`${temporaryRoot}${path.sep}`) ||
    !RUNTIME_DATA_ROOT_RE.test(path.basename(canonical)) ||
    /(^|[/\\])nimi_dev([/\\]|$)/u.test(canonical)
  ) {
    fail('unsafe_runtime_data_root', 'runtime-data-root is not an admitted disposable target');
  }
  return canonical;
}

function runtimeRootMarkerPath(runtimeDataRoot) {
  return path.join(runtimeDataRoot, '.realm-v3-full-data-runtime-root.json');
}

function liveEnvironmentDigestForRun(runLock) {
  return runLock.liveEnvironment
    ? domainHash('nimi.realm-v3-full-data-live-environment/v1', runLock.liveEnvironment)
    : '';
}

function assertPrivateCurrentUserPath(info, label) {
  if (HAS_POSIX_PERMISSION_BITS && info.uid !== process.getuid()) {
    fail('unsafe_runtime_data_root', `${label} is not owned by the current user`);
  }
  if (HAS_POSIX_PERMISSION_BITS && (info.mode & 0o077) !== 0) {
    fail('unsafe_runtime_data_root', `${label} permits group or other access`);
  }
}

async function requireOwnedRuntimeDataRoot(runtimeDataRoot, runLock) {
  let rootInfo;
  try {
    rootInfo = await lstat(runtimeDataRoot);
  } catch (error) {
    fail('missing_runtime_data_root', `frozen runtime data root is unavailable: ${error.message}`);
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    fail('unsafe_runtime_data_root', 'frozen runtime data root is not a regular directory');
  }
  assertPrivateCurrentUserPath(rootInfo, 'frozen runtime data root');
  if ((await realpath(runtimeDataRoot)) !== path.resolve(runtimeDataRoot)) {
    fail('unsafe_runtime_data_root', 'frozen runtime data root traverses a symlink');
  }
  const markerPath = runtimeRootMarkerPath(runtimeDataRoot);
  const markerInfo = await lstat(markerPath).catch((error) => {
    fail('runtime_root_marker_missing', `runtime data root ownership marker is unavailable: ${error.message}`);
  });
  if (!markerInfo.isFile() || markerInfo.isSymbolicLink()) {
    fail('runtime_root_marker_invalid', 'runtime data root ownership marker is not a regular file');
  }
  assertPrivateCurrentUserPath(markerInfo, 'runtime data root ownership marker');
  const marker = await readJSON(markerPath, 'runtime data root ownership marker');
  assertClosedObject(
    marker,
    ['schemaVersion', 'inputDigest', 'runtimeDataRootDigest', 'liveEnvironmentDigest'],
    [],
    'runtime data root ownership marker',
  );
  if (
    marker.schemaVersion !== RUNTIME_ROOT_MARKER_SCHEMA ||
    marker.inputDigest !== runLock.inputDigest ||
    marker.runtimeDataRootDigest !== runLock.runtimeDataRootDigest ||
    marker.liveEnvironmentDigest !== liveEnvironmentDigestForRun(runLock)
  ) {
    fail('runtime_root_marker_mismatch', 'runtime data root does not belong to the frozen full-data run');
  }
  return marker;
}

async function initializeRuntimeDataRoot(runtimeDataRoot, runLock, resume) {
  if (resume) return requireOwnedRuntimeDataRoot(runtimeDataRoot, runLock);
  try {
    const info = await lstat(runtimeDataRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      fail('unsafe_runtime_data_root', 'fresh runtime data root is not a regular directory');
    }
    assertPrivateCurrentUserPath(info, 'fresh runtime data root');
    if ((await readdir(runtimeDataRoot)).length !== 0) {
      fail('runtime_root_not_empty', 'fresh runtime data root must be empty');
    }
  } catch (error) {
    if (error instanceof FullDataContractError) throw error;
    if (error?.code !== 'ENOENT') throw error;
    await mkdir(runtimeDataRoot, { mode: 0o700 });
  }
  if ((await realpath(runtimeDataRoot)) !== path.resolve(runtimeDataRoot)) {
    fail('unsafe_runtime_data_root', 'fresh runtime data root traverses a symlink');
  }
  await writeJSONAtomic(runtimeRootMarkerPath(runtimeDataRoot), {
    schemaVersion: RUNTIME_ROOT_MARKER_SCHEMA,
    inputDigest: runLock.inputDigest,
    runtimeDataRootDigest: runLock.runtimeDataRootDigest,
    liveEnvironmentDigest: liveEnvironmentDigestForRun(runLock),
  });
  return requireOwnedRuntimeDataRoot(runtimeDataRoot, runLock);
}

async function initializePreflightRuntimeDataRoot(runtimeDataRoot, runLock, resume) {
  let rootInfo;
  try {
    rootInfo = await lstat(runtimeDataRoot);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return initializeRuntimeDataRoot(runtimeDataRoot, runLock, false);
  }
  if (!resume) {
    return initializeRuntimeDataRoot(runtimeDataRoot, runLock, false);
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    fail('unsafe_runtime_data_root', 'resumed runtime data root is not a regular directory');
  }
  assertPrivateCurrentUserPath(rootInfo, 'resumed runtime data root');
  if ((await realpath(runtimeDataRoot)) !== path.resolve(runtimeDataRoot)) {
    fail('unsafe_runtime_data_root', 'resumed runtime data root traverses a symlink');
  }
  try {
    await lstat(runtimeRootMarkerPath(runtimeDataRoot));
    return requireOwnedRuntimeDataRoot(runtimeDataRoot, runLock);
  } catch (error) {
    if (error instanceof FullDataContractError || error?.code !== 'ENOENT') throw error;
  }
  if ((await readdir(runtimeDataRoot)).length !== 0) {
    fail(
      'runtime_root_marker_missing',
      'unowned resumed runtime data root contains state and cannot be adopted',
    );
  }
  return initializeRuntimeDataRoot(runtimeDataRoot, runLock, false);
}

async function cleanupRuntimeDataRoot(runtimeDataRoot, runLock) {
  await requireOwnedRuntimeDataRoot(runtimeDataRoot, runLock);
  await rm(runtimeDataRoot, { recursive: true, force: false });
  try {
    await lstat(runtimeDataRoot);
    fail('runtime_root_cleanup_failed', 'disposable runtime data root still exists after cleanup');
  } catch (error) {
    if (error instanceof FullDataContractError) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function cleanupRuntimeDataRootResumable(evidenceDir, runtimeDataRoot, runLock) {
  const receiptPath = path.join(evidenceDir, 'runtime-cleanup.json');
  const quarantine = `${runtimeDataRoot}.n7-delete-${runLock.inputDigest.slice(0, 24)}`;
  const binding = {
    schemaVersion: RUNTIME_CLEANUP_SCHEMA,
    inputDigest: runLock.inputDigest,
    runtimeDataRootDigest: runLock.runtimeDataRootDigest,
    quarantineDigest: domainHash('nimi.realm-v3-full-data-runtime-cleanup-target/v1', quarantine),
  };
  let receipt;
  try {
    const info = await lstat(receiptPath);
    if (!info.isFile() || info.isSymbolicLink()) {
      fail('runtime_root_cleanup_failed', 'runtime cleanup receipt is not a regular file');
    }
    receipt = await readJSON(receiptPath, 'runtime cleanup receipt');
    assertClosedObject(
      receipt,
      [
        'schemaVersion',
        'inputDigest',
        'runtimeDataRootDigest',
        'quarantineDigest',
        'status',
        'reasonCode',
        'residue',
        'contentHash',
      ],
      [],
      'runtime cleanup receipt',
    );
    assertSHA256(receipt.contentHash, 'runtime cleanup receipt contentHash');
    const digestInput = { ...receipt };
    delete digestInput.contentHash;
    if (
      receipt.schemaVersion !== binding.schemaVersion ||
      receipt.inputDigest !== binding.inputDigest ||
      receipt.runtimeDataRootDigest !== binding.runtimeDataRootDigest ||
      receipt.quarantineDigest !== binding.quarantineDigest ||
      domainHash(RUNTIME_CLEANUP_SCHEMA, digestInput) !== receipt.contentHash ||
      !['PENDING', 'PASS'].includes(receipt.status)
    ) {
      fail('runtime_root_cleanup_failed', 'runtime cleanup receipt does not bind the frozen target');
    }
    if (receipt.status === 'PASS') {
      if (receipt.reasonCode !== 'passed' || receipt.residue !== 0) {
        fail('runtime_root_cleanup_failed', 'completed runtime cleanup receipt is inconsistent');
      }
      for (const target of [runtimeDataRoot, quarantine]) {
        try {
          await lstat(target);
          fail('runtime_root_cleanup_failed', 'completed runtime cleanup target still exists');
        } catch (error) {
          if (error instanceof FullDataContractError) throw error;
          if (error?.code !== 'ENOENT') throw error;
        }
      }
      return receipt;
    }
  } catch (error) {
    if (error instanceof FullDataContractError) throw error;
    if (error?.code !== 'ENOENT') throw error;
    await requireOwnedRuntimeDataRoot(runtimeDataRoot, runLock);
    try {
      await lstat(quarantine);
      fail('runtime_root_cleanup_failed', 'runtime cleanup quarantine already exists before ownership intent');
    } catch (quarantineError) {
      if (quarantineError instanceof FullDataContractError) throw quarantineError;
      if (quarantineError?.code !== 'ENOENT') throw quarantineError;
    }
    receipt = {
      ...binding,
      status: 'PENDING',
      reasonCode: 'cleanup_pending',
      residue: 1,
    };
    receipt.contentHash = domainHash(RUNTIME_CLEANUP_SCHEMA, receipt);
    await writeJSONAtomic(receiptPath, receipt);
  }

  const [rootInfo, quarantineInfo] = await Promise.all(
    [runtimeDataRoot, quarantine].map((target) => lstat(target).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    })),
  );
  if (rootInfo && quarantineInfo) {
    fail('runtime_root_cleanup_failed', 'runtime cleanup found both live and quarantine targets');
  }
  if (rootInfo) {
    await requireOwnedRuntimeDataRoot(runtimeDataRoot, runLock);
    await rename(runtimeDataRoot, quarantine);
    await syncDirectory(path.dirname(runtimeDataRoot));
  }
  try {
    const quarantineAfterRename = await lstat(quarantine);
    if (!quarantineAfterRename.isDirectory() || quarantineAfterRename.isSymbolicLink()) {
      fail('runtime_root_cleanup_failed', 'runtime cleanup quarantine is not an owned directory');
    }
    await requireOwnedRuntimeDataRoot(quarantine, runLock);
    await rm(quarantine, { recursive: true, force: false });
    await syncDirectory(path.dirname(quarantine));
  } catch (error) {
    if (error instanceof FullDataContractError) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const target of [runtimeDataRoot, quarantine]) {
    try {
      await lstat(target);
      fail('runtime_root_cleanup_failed', 'runtime cleanup retained target residue');
    } catch (error) {
      if (error instanceof FullDataContractError) throw error;
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  receipt = {
    ...binding,
    status: 'PASS',
    reasonCode: 'passed',
    residue: 0,
  };
  receipt.contentHash = domainHash(RUNTIME_CLEANUP_SCHEMA, receipt);
  await writeJSONAtomic(receiptPath, receipt);
  return receipt;
}


export {
  ACCESS_POLICY_VERSION,
  AGGREGATE_SCHEMA,
  AUTHORIZATION_BOUNDARY,
  AUTHORIZATION_INPUTS,
  CAPTURE_INDEX_SCHEMA,
  CLOSE_CANDIDATE_SCHEMA,
  CLOSED_EXECUTION_PATH,
  CONTRACT_EXACT_PATHS,
  CONTRACT_PATH_PATTERNS,
  FIRST_PARTY_AUTHORITY_CLASS,
  FIXED_PERSONA_SOURCE,
  FORBIDDEN_AUTHORIZATION_INPUTS,
  GIT_OBJECT_RE,
  MANIFEST_SCHEMA,
  PACKET_OPERATION,
  PACKET_SCHEMA,
  PROGRESS_INTERVAL_MS,
  REASON_RE,
  RECEIPT_SCHEMA,
  RETIRED_AUTHORIZATION_ENDPOINTS,
  RETIRED_AUTHORIZATION_IDENTIFIERS,
  RUNTIME_CLEANUP_SCHEMA,
  RUNTIME_DATA_ROOT_RE,
  RUNTIME_ROOT_MARKER_SCHEMA,
  RUN_LOCK_SCHEMA,
  SAFE_ID_RE,
  SHA256_RE,
  SNAPSHOT_SCHEMA,
  SOURCE_CENSUS_SCHEMA,
  STAGE_REPORT_SCHEMA,
  assertClosedObject,
  assertCount,
  assertEqual,
  assertExactKeys,
  assertGitObject,
  assertNoAmbientNodeInjection,
  assertPrivateCurrentUserPath,
  assertSHA256,
  assertString,
  canonicalPathThroughExistingAncestor,
  cleanupRuntimeDataRoot,
  cleanupRuntimeDataRootResumable,
  closedExecutionEnvironment,
  domainHash,
  ensurePrivateEvidenceDirectory,
  fail,
  git,
  gitBuffer,
  hashLengthFramed,
  hashUntrackedFiles,
  initializePreflightRuntimeDataRoot,
  initializeRuntimeDataRoot,
  liveEnvironmentDigestForRun,
  loadOptionalPrivateEvidenceArtifact,
  readJSON,
  requireOwnedRuntimeDataRoot,
  runtimeRootMarkerPath,
  sha256File,
  syncDirectory,
  validateEvidenceDirectory,
  validateRuntimeDataRoot,
  writeJSONAtomic,
};

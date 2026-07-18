import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  readdir,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  canonicalJSONStringify,
  CURRENT_ACCESS_POLICY_DIGEST,
  CURRENT_OPENAPI_DIGEST,
  domainHash,
  FIXED_REALM_COMMIT,
  FIXED_REALM_TREE,
  LIVE_ENVIRONMENT_MODULE_BASENAMES,
  sha256Hex,
  validateLiveEnvironmentAttestation,
} from '../realm-v3-full-data-census-worker.mjs';

export {
  canonicalJSONStringify,
  CURRENT_ACCESS_POLICY_DIGEST,
  CURRENT_OPENAPI_DIGEST,
  domainHash,
  FIXED_REALM_COMMIT,
  FIXED_REALM_TREE,
  LIVE_ENVIRONMENT_MODULE_BASENAMES,
  sha256Hex,
  validateLiveEnvironmentAttestation,
};

const N6_BASELINE_REALM_COMMIT = 'a30b2f488806e967ccba9ab8b81fe93935bdf474';
const N6_BASELINE_REALM_TREE = '3516b4727cbb17602d276e02755aeb36811ed2f2';
const N6_BASELINE_POLICY_DIGEST = '34f338ae76cbd85de58054cd6fc4d0ee18500030a0bc12f091e88d46f2fc572f';
export const PERSISTENT_DATABASE = 'nimi_dev';
export const DISPOSABLE_DATABASE_RE = /^nimi_realm_v3_n7_[0-9a-f]{32}$/u;
export const STATE_DIRECTORY_RE = /^nimi-realm-v3-full-data-[0-9a-f]{16,64}$/u;
export const STATE_SCHEMA = 'nimi.realm-v3-full-data-live-environment-state/v1';
export const MARKER_SCHEMA = 'nimi.realm-v3-full-data-live-environment-marker/v1';
export const ATTESTATION_SCHEMA = 'nimi.realm-v3-full-data-live-environment-attestation/v1';
export const CLEANUP_SCHEMA = 'nimi.realm-v3-full-data-live-environment-cleanup-receipt/v1';
export const CLOSE_CANDIDATE_SCHEMA = 'nimi.realm-v3-full-data-close-candidate/v1';
export const EVIDENCE_RELATIVE_ROOT = path.join(
  '.nimi',
  'local',
  'acceptance',
  '0717-nimi-realm-v3-consumer-hardcut',
  'N7',
);
export const CHILD_REGISTRATION_SCHEMA = 'nimi.realm-v3-full-data-live-child-registration/v1';
export const EXECUTION_RECEIPT_SCHEMA = 'nimi.realm-v3-full-data-live-execution-receipt/v1';
export const FIXTURE_SOURCE_PATH = 'scripts/realm-materialization/run-realm-fullchain.ts';
export const MATERIALIZER_ACCOUNT_ID = '01J00000000000000000000000';
export const FIXED_PERSONA_ID = 'persona-character-0716-fullchain-fixture';
export const N6_FROZEN_EVIDENCE_RELATIVE_PATH = path.join(
  '.nimi',
  'local',
  'acceptance',
  '0717-nimi-realm-v3-consumer-hardcut',
  'N6',
  'current-realm-live.json',
);
const SHA256_RE = /^[0-9a-f]{64}$/u;
const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const SAFE_EXECUTION_PARTITION_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u;
const REDIS_CONTAINER_RE = /^nimi-realm-v3-n7-redis-[0-9a-f]{32}$/u;
const MAX_CAPTURE_BYTES = 128 * 1024 * 1024;
const TRUSTED_TOOL_NAMES = ['docker', 'git', 'go', 'pnpm', 'ps', 'tar'];
const MODULE_NIMI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FORBIDDEN_AMBIENT_CHILD_VARIABLES = [
  'NODE_OPTIONS',
  'NODE_PATH',
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'npm_config_proxy',
  'npm_config_https_proxy',
  'DATABASE_URL',
  'TEST_DATABASE_URL',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE',
];
const CLOSED_ENVIRONMENT_AUTHORITY_FIELDS = [
  'PATH',
  'HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
  'NPM_CONFIG_USERCONFIG',
  'npm_config_userconfig',
  'GOENV',
  'GOTOOLCHAIN',
  'GOMODCACHE',
  'GOCACHE',
  'LANG',
  'LC_ALL',
  'TZ',
];
let activeTrustedToolPaths = null;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertSHA256(value, label) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) fail('invalid_digest', `${label} is not SHA-256`);
}

function assertSafeName(value, label) {
  if (typeof value !== 'string' || !SAFE_NAME_RE.test(value)) fail('unsafe_target', `${label} is unsafe`);
  return value;
}

function assertNoAmbientChildInjection(environment = process.env) {
  const present = FORBIDDEN_AMBIENT_CHILD_VARIABLES.filter(
    (name) => typeof environment[name] === 'string' && environment[name] !== '',
  );
  if (present.length > 0) {
    fail('ambient_child_injection', `ambient child injection variables are forbidden: ${present.join(',')}`);
  }
}

function activateTrustedToolPaths(tools) {
  assertClosedKeys(tools, TRUSTED_TOOL_NAMES, 'trusted tool paths', 'wrapper_identity_invalid');
  const bound = {};
  for (const name of TRUSTED_TOOL_NAMES) {
    const candidate = tools[name];
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
      fail('wrapper_identity_invalid', `trusted ${name} executable path is invalid`);
    }
    bound[name] = candidate;
  }
  activeTrustedToolPaths = Object.freeze(bound);
}

function closedProcessEnvironment(extra = {}, options = {}) {
  if (!activeTrustedToolPaths) fail('wrapper_identity_invalid', 'trusted tool closure is not active');
  const allowedDatabaseFields = options.allowDatabase === true
    ? new Set(['DATABASE_URL', 'TEST_DATABASE_URL'])
    : new Set();
  for (const name of Object.keys(extra)) {
    if (CLOSED_ENVIRONMENT_AUTHORITY_FIELDS.includes(name)) {
      fail('ambient_child_injection', `closed child environment cannot override ${name}`);
    }
    if (
      FORBIDDEN_AMBIENT_CHILD_VARIABLES.includes(name) &&
      !allowedDatabaseFields.has(name)
    ) {
      fail('ambient_child_injection', `closed child environment rejects ${name}`);
    }
  }
  const searchDirectories = [
    path.dirname(process.execPath),
    ...TRUSTED_TOOL_NAMES.map((name) => path.dirname(activeTrustedToolPaths[name])),
  ];
  return {
    PATH: [...new Set(searchDirectories)].join(path.delimiter),
    HOME: '/var/empty',
    XDG_CONFIG_HOME: '/var/empty',
    XDG_CACHE_HOME: '/var/empty',
    XDG_DATA_HOME: '/var/empty',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    NPM_CONFIG_USERCONFIG: '/dev/null',
    npm_config_userconfig: '/dev/null',
    GOENV: 'off',
    GOTOOLCHAIN: 'local',
    GOMODCACHE: '/var/empty',
    GOCACHE: '/var/empty',
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    ...extra,
  };
}

function closedBootstrapEnvironment(extra = {}) {
  return {
    PATH: path.dirname(process.execPath),
    HOME: '/var/empty',
    XDG_CONFIG_HOME: '/var/empty',
    XDG_CACHE_HOME: '/var/empty',
    XDG_DATA_HOME: '/var/empty',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    NPM_CONFIG_USERCONFIG: '/dev/null',
    npm_config_userconfig: '/dev/null',
    GOENV: 'off',
    GOTOOLCHAIN: 'local',
    GOMODCACHE: '/var/empty',
    GOCACHE: '/var/empty',
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    ...extra,
  };
}

export function assertDisposableDatabaseName(database) {
  if (database === PERSISTENT_DATABASE || !DISPOSABLE_DATABASE_RE.test(database)) {
    fail('unsafe_database_target', 'disposable database name is not an admitted random N7 target');
  }
  return database;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function assertSafeStateDirectoryTarget(stateDirectory, repositoryRoots = []) {
  if (!path.isAbsolute(stateDirectory)) fail('unsafe_state_directory', 'state-dir must be absolute');
  const resolved = path.resolve(stateDirectory);
  if (!STATE_DIRECTORY_RE.test(path.basename(resolved))) {
    fail('unsafe_state_directory', 'state-dir basename is not an admitted random N7 target');
  }
  const temporaryRoot = await realpath(tmpdir());
  const parentReal = await realpath(path.dirname(resolved));
  const canonical = path.join(parentReal, path.basename(resolved));
  if (!isInside(temporaryRoot, canonical)) {
    fail('unsafe_state_directory', 'state-dir must be inside the operating-system temporary root');
  }
  const forbidden = [path.resolve('/'), path.resolve(homedir()), ...repositoryRoots.map((entry) => path.resolve(entry))];
  for (const root of forbidden) {
    if (canonical === root || (root !== path.parse(root).root && isInside(root, canonical))) {
      fail('unsafe_state_directory', `state-dir overlaps forbidden root ${root}`);
    }
  }
  return canonical;
}

async function ensurePrivateDirectory(directory) {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('unsafe_state_directory', 'state-dir is not a real directory');
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    fail('unsafe_state_directory', 'state-dir is not owned by the current uid');
  }
  if ((info.mode & 0o777) !== 0o700) fail('unsafe_state_directory', 'state-dir mode must be exactly 0700');
  // Also repeat this on resume so a crash between mkdir and parent fsync is recoverable.
  await syncDirectory(path.dirname(directory));
}

async function writePrivateJSON(filePath, value) {
  const parentInfo = await lstat(path.dirname(filePath));
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    fail('unsafe_output', 'JSON output parent is not a real directory');
  }
  if (typeof process.getuid === 'function' && parentInfo.uid !== process.getuid()) {
    fail('unsafe_output', 'JSON output parent is not owned by the current uid');
  }
  if (await pathExists(filePath)) {
    await assertPrivateRegularFile(filePath, 'existing JSON output');
  }
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${canonicalJSONStringify(value)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await assertPrivateRegularFile(temporary, 'temporary JSON output');
  await durableRename(temporary, filePath);
  await assertPrivateRegularFile(filePath, 'published JSON output');
}

async function assertPrivateRegularFile(filePath, label) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) fail('unsafe_output', `${label} is not a regular non-symlink file`);
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    fail('unsafe_output', `${label} is not owned by the current uid`);
  }
  if ((info.mode & 0o777) !== 0o600) fail('unsafe_output', `${label} mode must be exactly 0600`);
}

async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function durableRename(source, target) {
  await rename(source, target);
  await syncDirectory(path.dirname(target));
}

async function readJSON(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    fail('invalid_state', `${label} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readRegularJSONInput(filePath, label) {
  if (!path.isAbsolute(filePath)) fail('invalid_input', `${label} path must be absolute`);
  const resolved = path.resolve(filePath);
  const info = await lstat(resolved);
  if (!info.isFile() || info.isSymbolicLink()) fail('invalid_input', `${label} must be a regular non-symlink file`);
  return { path: resolved, value: await readJSON(resolved, label) };
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertDirectoryChainHasNoSymlink(root, directory, label) {
  const relative = path.relative(root, directory);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('unsafe_evidence_output', `${label} escapes its admitted evidence root`);
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      fail('unsafe_evidence_output', `${label} has a symlink/non-directory ancestor`);
    }
  }
}

export async function assertAdmittedEvidenceOutput(rootRealm, outputPath, expectedBasename) {
  if (!path.isAbsolute(outputPath)) fail('unsafe_evidence_output', 'evidence output must be absolute');
  const lexicalNimiRoot = path.resolve(rootRealm, 'nimi');
  const nimiInfo = await lstat(lexicalNimiRoot);
  if (!nimiInfo.isDirectory() || nimiInfo.isSymbolicLink()) {
    fail('unsafe_evidence_output', 'Nimi evidence owner root is not a real directory');
  }
  const nimiRoot = await realpath(lexicalNimiRoot);
  const evidenceRoot = path.join(nimiRoot, EVIDENCE_RELATIVE_ROOT);
  const lexicalEvidenceRoot = path.join(lexicalNimiRoot, EVIDENCE_RELATIVE_ROOT);
  const lexicalTarget = path.resolve(outputPath);
  if (!isInside(lexicalEvidenceRoot, lexicalTarget) || path.basename(lexicalTarget) !== expectedBasename) {
    fail(
      'unsafe_evidence_output',
      `evidence output must be ${expectedBasename} below ${EVIDENCE_RELATIVE_ROOT}`,
    );
  }
  await assertDirectoryChainHasNoSymlink(lexicalNimiRoot, path.dirname(lexicalTarget), 'evidence output');
  const target = path.join(await realpath(path.dirname(lexicalTarget)), path.basename(lexicalTarget));
  if (!isInside(evidenceRoot, target)) {
    fail('unsafe_evidence_output', 'evidence output canonical path escapes its admitted root');
  }
  if (await pathExists(target)) {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) {
      fail('unsafe_evidence_output', 'existing evidence output is not a regular non-symlink file');
    }
  }
  return target;
}

async function assertAdmittedEvidencePath(rootRealm, candidatePath, label) {
  if (!path.isAbsolute(candidatePath || '')) fail('unsafe_evidence_output', `${label} must be absolute`);
  const lexicalNimiRoot = path.resolve(rootRealm, 'nimi');
  const nimiInfo = await lstat(lexicalNimiRoot);
  if (!nimiInfo.isDirectory() || nimiInfo.isSymbolicLink()) {
    fail('unsafe_evidence_output', 'Nimi evidence owner root is not a real directory');
  }
  const nimiRoot = await realpath(lexicalNimiRoot);
  const lexicalEvidenceRoot = path.join(lexicalNimiRoot, EVIDENCE_RELATIVE_ROOT);
  const evidenceRoot = path.join(nimiRoot, EVIDENCE_RELATIVE_ROOT);
  const lexicalTarget = path.resolve(candidatePath);
  if (!isInside(lexicalEvidenceRoot, lexicalTarget)) {
    fail('unsafe_evidence_output', `${label} escapes ${EVIDENCE_RELATIVE_ROOT}`);
  }
  await assertDirectoryChainHasNoSymlink(lexicalNimiRoot, path.dirname(lexicalTarget), label);
  const target = path.join(await realpath(path.dirname(lexicalTarget)), path.basename(lexicalTarget));
  if (!isInside(evidenceRoot, target)) {
    fail('unsafe_evidence_output', `${label} canonical path escapes its admitted root`);
  }
  return target;
}

function sanitizedChildBaseEnvironment() {
  return closedProcessEnvironment();
}

async function runCapture(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const executable = TRUSTED_TOOL_NAMES.includes(command)
      ? activeTrustedToolPaths?.[command]
      : command;
    if (!executable) {
      rejectPromise(new Error(`trusted executable binding is missing for ${command}`));
      return;
    }
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? (activeTrustedToolPaths ? closedProcessEnvironment() : closedBootstrapEnvironment()),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const reject = (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    };
    child.once('error', reject);
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_CAPTURE_BYTES) {
        child.kill('SIGKILL');
        reject(new Error(`${command} stdout exceeded safety limit`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_CAPTURE_BYTES) {
        child.kill('SIGKILL');
        reject(new Error(`${command} stderr exceeded safety limit`));
        return;
      }
      stderr.push(chunk);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      const result = {
        code: code ?? 1,
        signal: signal ?? null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (result.code !== 0) {
        const error = new Error(
          `${command} exited ${result.code}${result.signal ? ` (${result.signal})` : ''}: ${result.stderr.trim()}`,
        );
        error.result = result;
        rejectPromise(error);
      } else {
        resolvePromise(result);
      }
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

async function hashFile(filePath) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) fail('invalid_artifact', `${filePath} is not a regular file`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function readFrozenN6Baseline(nimiRoot) {
  const evidencePath = path.join(nimiRoot, N6_FROZEN_EVIDENCE_RELATIVE_PATH);
  const canonicalNimiRoot = await realpath(nimiRoot);
  const canonicalEvidencePath = await realpath(evidencePath);
  if (!isInside(canonicalNimiRoot, canonicalEvidencePath)) {
    fail('n6_baseline_invalid', 'frozen N6 evidence escapes the Nimi repository');
  }
  const info = await lstat(canonicalEvidencePath);
  if (!info.isFile() || info.isSymbolicLink()) {
    fail('n6_baseline_invalid', 'frozen N6 evidence is not a regular non-symlink file');
  }
  const raw = await readFile(canonicalEvidencePath);
  let evidence;
  try {
    evidence = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    fail('n6_baseline_invalid', `frozen N6 evidence is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const before = evidence?.sourceDatabase?.before;
  const after = evidence?.sourceDatabase?.after;
  const persona = evidence?.sources?.personaCharacter;
  if (
    evidence?.schemaVersion !== 'nimi.realm-v3-current-realm-live-acceptance/v1' ||
    evidence?.verdict !== 'PASS' || evidence?.productFailures !== 0 ||
    evidence?.authority?.producerCommit !== N6_BASELINE_REALM_COMMIT ||
    evidence?.authority?.producerTree !== N6_BASELINE_REALM_TREE ||
    evidence?.authority?.accessPolicyDigest !== N6_BASELINE_POLICY_DIGEST ||
    evidence?.sourceDatabase?.name !== PERSISTENT_DATABASE ||
    evidence?.sourceDatabase?.unchanged !== true ||
    canonicalJSONStringify(before) !== canonicalJSONStringify(after) ||
    before?.worldCharacters !== 470 || before?.personaCharacters !== 1 ||
    evidence?.isolationAndCleanup?.persistentSharedDatabaseWrites !== 0 ||
    evidence?.isolationAndCleanup?.rootProductWrites !== 0 ||
    evidence?.isolationAndCleanup?.nimiProductWritesByLiveHarness !== 0 ||
    persona?.sourceId !== FIXED_PERSONA_ID ||
    persona?.ownerAccountId !== MATERIALIZER_ACCOUNT_ID ||
    typeof persona?.worldId !== 'string' || persona.worldId.length === 0 ||
    !SHA256_RE.test(persona?.sourceHash || '') || persona?.status !== 'PASS'
  ) {
    fail('n6_baseline_invalid', 'frozen N6 evidence does not prove the admitted immutable 470/1 baseline');
  }
  const personaSourceRef = {
    kind: 'personaCharacter',
    id: persona.sourceId,
    worldId: persona.worldId,
    sourceHash: persona.sourceHash,
    ownerAccountId: persona.ownerAccountId,
  };
  return {
    path: canonicalEvidencePath,
    sha256: sha256Hex(raw),
    evidenceClass: 'historical_dataset_identity_only',
    personaSourceRef,
    personaSourceRefHash: domainHash('nimi.realm-v3-full-data-source-ref/v1', personaSourceRef),
  };
}

function assertPersistentMatchesFrozenN6(persistent, baseline) {
  if (
    persistent.worlds.length !== 470 || persistent.personas.length !== 1 ||
    canonicalJSONStringify(persistent.personas[0]) !== canonicalJSONStringify(baseline.personaSourceRef)
  ) {
    fail('n6_baseline_mismatch', 'persistent nimi_dev does not match the frozen N6 470/1 Persona baseline');
  }
}

async function captureTrustedFileIdentity(filePath, label, options = {}) {
  if (!path.isAbsolute(filePath)) fail('wrapper_identity_invalid', `${label} path must be absolute`);
  const canonicalPath = await realpath(filePath);
  const info = await lstat(canonicalPath);
  if (!info.isFile() || info.isSymbolicLink()) {
    fail('wrapper_identity_invalid', `${label} must be a regular non-symlink file`);
  }
  const mode = info.mode & 0o777;
  if ((mode & 0o022) !== 0) fail('wrapper_identity_invalid', `${label} is group/world writable`);
  if (options.executable === true && (mode & 0o111) === 0) {
    fail('wrapper_identity_invalid', `${label} is not executable`);
  }
  if (options.currentUID === true && typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    fail('wrapper_identity_invalid', `${label} is not owned by the current uid`);
  }
  const sanitized = {
    pathHash: sha256Hex(canonicalPath),
    sha256: await hashFile(canonicalPath),
    bytes: info.size,
    mode,
    uid: info.uid,
  };
  sanitized.identityDigest = domainHash('nimi.realm-v3-full-data-trusted-file-identity/v1', sanitized);
  return { canonicalPath, sanitized };
}

async function captureGoExecutableIdentity(filePath, label, goExecutable) {
  const identity = await captureTrustedFileIdentity(filePath, label, {
    executable: true,
    currentUID: true,
  });
  let buildInfo;
  try {
    buildInfo = await runCapture(goExecutable, ['version', '-m', identity.canonicalPath], {
      env: closedBootstrapEnvironment(),
    });
  } catch {
    fail('wrapper_identity_invalid', `${label} is not an inspectable Go binary`);
  }
  const normalized = buildInfo.stdout.trim();
  if (!normalized || !/(?:^|\s)go1\.[0-9]+/u.test(normalized)) {
    fail('wrapper_identity_invalid', `${label} lacks Go build identity`);
  }
  return {
    ...identity,
    goBuildInfoDigest: domainHash('nimi.realm-v3-full-data-go-build-info/v1', normalized),
  };
}

function validateClosedArgs(args, label) {
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string' || value.includes('\0'))) {
    fail('child_registration_invalid', `${label} args are not a closed string array`);
  }
  return args;
}

function assertClosedKeys(value, keys, label, code = 'child_registration_invalid') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, `${label} is not an object`);
  if (canonicalJSONStringify(Object.keys(value).sort()) !== canonicalJSONStringify([...keys].sort())) {
    fail(code, `${label} is not a closed object`);
  }
}

export async function validateLiveChildRegistration(value, context) {
  assertClosedKeys(value, ['schemaVersion', 'children', 'tools', 'contentHash'], 'child registration');
  if (value.schemaVersion !== CHILD_REGISTRATION_SCHEMA || !Array.isArray(value.children) || value.children.length !== 2) {
    fail('child_registration_invalid', 'child registration must contain exactly census and partition children');
  }
  assertSHA256(value.contentHash, 'child registration contentHash');
  const digestInput = { ...value };
  delete digestInput.contentHash;
  if (domainHash(CHILD_REGISTRATION_SCHEMA, digestInput) !== value.contentHash) {
    fail('child_registration_invalid', 'child registration content hash mismatch');
  }
  assertClosedKeys(value.tools, TRUSTED_TOOL_NAMES, 'child registration tools');
  const tools = {};
  for (const name of TRUSTED_TOOL_NAMES) {
    tools[name] = await captureTrustedFileIdentity(
      value.tools[name],
      `registered ${name} executable`,
      { executable: true },
    );
  }
  const children = [];
  for (const child of value.children) {
    if (child.kind === 'node_script') {
      assertClosedKeys(child, ['stage', 'kind', 'command', 'script', 'args'], 'node child');
      if (child.stage !== 'census') fail('child_registration_invalid', 'node child stage must be census');
      const command = await captureTrustedFileIdentity(child.command, 'registered Node executable', { executable: true });
      if (command.canonicalPath !== context.wrapper.node.canonicalPath) {
        fail('child_registration_invalid', 'census command is not the bound canonical Node executable');
      }
      const expectedScript = path.join(context.nimiRoot, 'scripts', 'realm-v3-full-data-census-worker.mjs');
      const script = await captureTrustedFileIdentity(child.script, 'registered census script', { currentUID: true });
      if (script.canonicalPath !== await realpath(expectedScript)) {
        fail('child_registration_invalid', 'registered census script is not the canonical Nimi worker');
      }
      const args = validateClosedArgs(child.args, 'census child');
      const argsDigest = domainHash('nimi.realm-v3-full-data-live-child-args/v1', [script.canonicalPath, ...args]);
      const sanitized = {
        stage: child.stage,
        kind: child.kind,
        command: command.sanitized,
        script: script.sanitized,
        argsDigest,
        argsCount: args.length + 1,
      };
      sanitized.childIdentityDigest = domainHash('nimi.realm-v3-full-data-live-child-identity/v1', sanitized);
      children.push({ raw: { ...child, command: command.canonicalPath, script: script.canonicalPath, args }, sanitized });
    } else if (child.kind === 'native') {
      assertClosedKeys(child, ['stage', 'kind', 'command', 'args'], 'native child');
      if (child.stage !== 'partition') fail('child_registration_invalid', 'native child stage must be partition');
      const command = await captureGoExecutableIdentity(
        child.command,
        'registered native worker',
        tools.go.canonicalPath,
      );
      const args = validateClosedArgs(child.args, 'native child');
      const argsDigest = domainHash('nimi.realm-v3-full-data-live-child-args/v1', args);
      const sanitized = {
        stage: child.stage,
        kind: child.kind,
        command: command.sanitized,
        goBuildInfoDigest: command.goBuildInfoDigest,
        argsDigest,
        argsCount: args.length,
      };
      sanitized.childIdentityDigest = domainHash('nimi.realm-v3-full-data-live-child-identity/v1', sanitized);
      children.push({ raw: { ...child, command: command.canonicalPath, args }, sanitized });
    } else {
      fail('child_registration_invalid', 'child kind is not admitted');
    }
  }
  children.sort((left, right) => left.sanitized.stage.localeCompare(right.sanitized.stage));
  if (children[0]?.sanitized.stage !== 'census' || children[1]?.sanitized.stage !== 'partition') {
    fail('child_registration_invalid', 'child registration stages are incomplete or duplicated');
  }
  return {
    schemaVersion: CHILD_REGISTRATION_SCHEMA,
    contentHash: value.contentHash,
    children,
    tools,
    registrationDigest: domainHash('nimi.realm-v3-full-data-live-child-registration-binding/v1', {
      contentHash: value.contentHash,
      children: children.map((entry) => entry.sanitized),
      tools: Object.fromEntries(TRUSTED_TOOL_NAMES.map((name) => [name, tools[name].sanitized])),
    }),
  };
}

async function captureWrapperTrust(nimiRoot, registrationPath) {
  const cliPath = path.join(nimiRoot, 'scripts', 'realm-v3-full-data-live-environment.mjs');
  const moduleRoot = path.join(nimiRoot, 'scripts', 'lib');
  const [modules, cli, node] = await Promise.all([
    Promise.all(LIVE_ENVIRONMENT_MODULE_BASENAMES.map(async (name) => ({
      name,
      identity: await captureTrustedFileIdentity(
        path.join(moduleRoot, name),
        `live environment module ${name}`,
        { currentUID: true },
      ),
    }))),
    captureTrustedFileIdentity(cliPath, 'live environment CLI', { currentUID: true }),
    captureTrustedFileIdentity(await realpath(process.execPath), 'canonical Node executable', { executable: true }),
  ]);
  const wrapper = { modules, cli, node };
  const registrationInput = await readRegularJSONInput(registrationPath, 'live child registration');
  const registration = await validateLiveChildRegistration(registrationInput.value, { wrapper, nimiRoot });
  const sanitized = {
    modules: modules.map(({ name, identity }) => ({ name, identity: identity.sanitized })),
    cli: cli.sanitized,
    node: node.sanitized,
    tools: Object.fromEntries(
      TRUSTED_TOOL_NAMES.map((name) => [name, registration.tools[name].sanitized]),
    ),
    childRegistrationDigest: registration.registrationDigest,
    allowedChildren: registration.children.map((entry) => entry.sanitized),
  };
  sanitized.wrapperIdentityDigest = domainHash('nimi.realm-v3-full-data-live-wrapper-identity/v1', sanitized);
  return {
    registrationPath: registrationInput.path,
    modules,
    cli,
    node,
    registration,
    sanitized,
  };
}

function activateWrapperToolClosure(wrapperTrust) {
  activateTrustedToolPaths(
    Object.fromEntries(
      TRUSTED_TOOL_NAMES.map((name) => [name, wrapperTrust.registration.tools[name].canonicalPath]),
    ),
  );
}

async function verifyAndActivateStateToolClosure(state) {
  const trust = await captureWrapperTrust(state.nimiRoot, state.childRegistrationPath);
  if (canonicalJSONStringify(trust.sanitized) !== canonicalJSONStringify(state.wrapperTrust)) {
    fail('wrapper_identity_drift', 'state trusted tool/wrapper closure changed');
  }
  activateWrapperToolClosure(trust);
  return trust;
}

export function validateLiveEnvironmentExecutionReceipt(receipt, expected = {}) {
  assertClosedKeys(
    receipt,
    [
      'schemaVersion',
      'status',
      'reasonCode',
      'environmentAttestationDigest',
      'wrapperIdentityDigest',
      'childRegistrationDigest',
      'stage',
      'partitionIdHash',
      'executionReceiptPathHash',
      'childIdentityDigest',
      'argsDigest',
      'exitCode',
      'signal',
      'preExecutionWrapperIdentityDigest',
      'postExecutionWrapperIdentityDigest',
      'preExecutionChildIdentityDigest',
      'postExecutionChildIdentityDigest',
      'apiProcessIntentDigest',
      'apiGeneration',
      'apiProcessIdentityDigest',
      'postExecutionAPIProcessIdentityDigest',
      'apiIdentityUnchanged',
      'runtimeDependencyClosureDigest',
      'identityUnchanged',
      'contentHash',
    ],
    'live execution receipt',
    'invalid_execution_receipt',
  );
  if (
    receipt.schemaVersion !== EXECUTION_RECEIPT_SCHEMA ||
    !['PASS', 'FAIL'].includes(receipt.status) ||
    !['census', 'partition'].includes(receipt.stage)
  ) {
    fail('invalid_execution_receipt', 'live execution receipt schema/verdict/stage is invalid');
  }
  for (const field of [
    'environmentAttestationDigest',
    'wrapperIdentityDigest',
    'childRegistrationDigest',
    'partitionIdHash',
    'executionReceiptPathHash',
    'childIdentityDigest',
    'argsDigest',
    'preExecutionWrapperIdentityDigest',
    'postExecutionWrapperIdentityDigest',
    'preExecutionChildIdentityDigest',
    'postExecutionChildIdentityDigest',
    'apiProcessIntentDigest',
    'apiProcessIdentityDigest',
    'postExecutionAPIProcessIdentityDigest',
    'runtimeDependencyClosureDigest',
    'contentHash',
  ]) {
    assertSHA256(receipt[field], `live execution receipt ${field}`);
  }
  if (
    !Number.isSafeInteger(receipt.apiGeneration) || receipt.apiGeneration < 1 ||
    receipt.exitCode !== null &&
    (!Number.isSafeInteger(receipt.exitCode) || receipt.exitCode < 0 || receipt.exitCode > 255)
  ) {
    fail('invalid_execution_receipt', 'live execution receipt exitCode is invalid');
  }
  if (receipt.signal !== null && (typeof receipt.signal !== 'string' || !/^[A-Z][A-Z0-9]{1,15}$/u.test(receipt.signal))) {
    fail('invalid_execution_receipt', 'live execution receipt signal is invalid');
  }
  const wrapperUnchanged =
    receipt.preExecutionWrapperIdentityDigest === receipt.wrapperIdentityDigest &&
    receipt.postExecutionWrapperIdentityDigest === receipt.wrapperIdentityDigest;
  const childUnchanged =
    receipt.preExecutionChildIdentityDigest === receipt.childIdentityDigest &&
    receipt.postExecutionChildIdentityDigest === receipt.childIdentityDigest;
  const apiUnchanged =
    receipt.apiProcessIdentityDigest === receipt.postExecutionAPIProcessIdentityDigest;
  if (receipt.apiIdentityUnchanged !== apiUnchanged) {
    fail('invalid_execution_receipt', 'live execution receipt API identity verdict is inconsistent');
  }
  if (receipt.identityUnchanged !== (wrapperUnchanged && childUnchanged && apiUnchanged)) {
    fail('invalid_execution_receipt', 'live execution receipt identity verdict is inconsistent');
  }
  if (
    receipt.status === 'PASS' &&
    (
      receipt.reasonCode !== 'passed' || receipt.exitCode !== 0 || receipt.signal !== null ||
      receipt.identityUnchanged !== true
    )
  ) {
    fail('invalid_execution_receipt', 'passing live execution receipt lacks zero-exit identity parity');
  }
  if (
    receipt.status === 'FAIL' &&
    !['spawn_failed', 'child_failed', 'identity_drift'].includes(receipt.reasonCode)
  ) {
    fail('invalid_execution_receipt', 'failed live execution receipt reason is invalid');
  }
  if (receipt.reasonCode === 'identity_drift' && receipt.identityUnchanged !== false) {
    fail('invalid_execution_receipt', 'identity-drift receipt falsely claims identity parity');
  }
  if (
    receipt.reasonCode === 'spawn_failed' &&
    (receipt.exitCode !== null || receipt.signal !== null)
  ) {
    fail('invalid_execution_receipt', 'spawn-failed receipt has a child exit result');
  }
  if (
    receipt.reasonCode === 'child_failed' &&
    receipt.exitCode === 0 && receipt.signal === null
  ) {
    fail('invalid_execution_receipt', 'child-failed receipt has a successful child exit');
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (expectedValue !== undefined && receipt[field] !== expectedValue) {
      fail('invalid_execution_receipt', `live execution receipt ${field} binding mismatch`);
    }
  }
  const digestInput = { ...receipt };
  delete digestInput.contentHash;
  if (domainHash(EXECUTION_RECEIPT_SCHEMA, digestInput) !== receipt.contentHash) {
    fail('invalid_execution_receipt', 'live execution receipt content hash mismatch');
  }
  return receipt;
}

async function directoryManifest(root) {
  const rows = [];
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isSymbolicLink()) fail('invalid_artifact', `artifact symlink is not admitted: ${relative}`);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const info = await stat(absolute);
        rows.push({ path: relative, bytes: info.size, sha256: await hashFile(absolute) });
      } else fail('invalid_artifact', `artifact entry is not regular: ${relative}`);
    }
  };
  await walk(root);
  return rows;
}

export {
  CLOSED_ENVIRONMENT_AUTHORITY_FIELDS,
  FORBIDDEN_AMBIENT_CHILD_VARIABLES,
  MAX_CAPTURE_BYTES,
  MODULE_NIMI_ROOT,
  N6_BASELINE_POLICY_DIGEST,
  N6_BASELINE_REALM_COMMIT,
  N6_BASELINE_REALM_TREE,
  REDIS_CONTAINER_RE,
  SAFE_EXECUTION_PARTITION_RE,
  SAFE_NAME_RE,
  SHA256_RE,
  TRUSTED_TOOL_NAMES,
  activateTrustedToolPaths,
  activateWrapperToolClosure,
  assertAdmittedEvidencePath,
  assertClosedKeys,
  assertDirectoryChainHasNoSymlink,
  assertNoAmbientChildInjection,
  assertPersistentMatchesFrozenN6,
  assertPrivateRegularFile,
  assertSHA256,
  assertSafeName,
  captureGoExecutableIdentity,
  captureTrustedFileIdentity,
  captureWrapperTrust,
  closedBootstrapEnvironment,
  closedProcessEnvironment,
  directoryManifest,
  durableRename,
  ensurePrivateDirectory,
  fail,
  hashFile,
  isInside,
  pathExists,
  readFrozenN6Baseline,
  readJSON,
  readRegularJSONInput,
  runCapture,
  sanitizedChildBaseEnvironment,
  syncDirectory,
  validateClosedArgs,
  verifyAndActivateStateToolClosure,
  writePrivateJSON,
};

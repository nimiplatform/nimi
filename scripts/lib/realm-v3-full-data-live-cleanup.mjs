import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
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
  writeFile,
} from 'node:fs/promises';
import { closeSync, createReadStream, openSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildSnapshotProof,
  canonicalJSONStringify,
  domainHash,
  sha256Hex,
  validateLiveEnvironmentAttestation,
} from '../realm-v3-full-data-census-worker.mjs';

import {
  ATTESTATION_SCHEMA,
  CHILD_REGISTRATION_SCHEMA,
  CLEANUP_SCHEMA,
  CLOSED_ENVIRONMENT_AUTHORITY_FIELDS,
  CLOSE_CANDIDATE_SCHEMA,
  DISPOSABLE_DATABASE_RE,
  EVIDENCE_RELATIVE_ROOT,
  EXECUTION_RECEIPT_SCHEMA,
  FIXED_PERSONA_ID,
  FIXED_REALM_COMMIT,
  FIXED_REALM_TREE,
  FIXTURE_SOURCE_PATH,
  MARKER_SCHEMA,
  MATERIALIZER_ACCOUNT_ID,
  MAX_CAPTURE_BYTES,
  MODULE_NIMI_ROOT,
  N6_FROZEN_EVIDENCE_RELATIVE_PATH,
  PERSISTENT_DATABASE,
  REDIS_CONTAINER_RE,
  SAFE_EXECUTION_PARTITION_RE,
  SAFE_NAME_RE,
  SHA256_RE,
  STATE_DIRECTORY_RE,
  STATE_SCHEMA,
  TRUSTED_TOOL_NAMES,
  activateTrustedToolPaths,
  activateWrapperToolClosure,
  assertAdmittedEvidenceOutput,
  assertAdmittedEvidencePath,
  assertClosedKeys,
  assertDirectoryChainHasNoSymlink,
  assertDisposableDatabaseName,
  assertNoAmbientChildInjection,
  assertPersistentMatchesFrozenN6,
  assertPrivateRegularFile,
  assertSHA256,
  assertSafeName,
  assertSafeStateDirectoryTarget,
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
  validateLiveChildRegistration,
  validateLiveEnvironmentExecutionReceipt,
  verifyAndActivateStateToolClosure,
  writePrivateJSON,
} from './realm-v3-full-data-live-contract.mjs';

import {
  boundaryDigests,
  captureWriteBoundary,
} from './realm-v3-full-data-live-attestation.mjs';

import {
  assertRuntimeDependencyClosure,
  buildRedisIntent,
  classifyPreparedRedisObservation,
  createDisposableClone,
  databaseExists,
  dependencyRootDigest,
  deriveDisposableDatabaseURL,
  dropDisposableDatabase,
  exportAndBuildFixedRealm,
  fixedFixtureHelperSource,
  inspectDockerContainer,
  observeRedis,
  parseOfflineStoreDirectory,
  readDatabaseSnapshot,
  readFrozenOfflineStoreDirectory,
  reconcilePreparedRedis,
  relativeExecutionPath,
  reserveLoopbackPort,
  runtimeDependencyClosureManifest,
  sourceRowsSQL,
  startRedis,
} from './realm-v3-full-data-live-infrastructure.mjs';

import {
  assertPreparedAPIStateBinding,
  assertRecoveredFixedPersona,
  base64URL,
  buildAPIIntent,
  buildCredentialsIntent,
  captureProcessIdentity,
  classifyInterruptedPersonaRecovery,
  classifyPreparedAPIObservation,
  createFormalPersona,
  declaredPersonaProvisioningIntent,
  establishFormalOAuthSession,
  findAPIProcessByIntent,
  normalizePrepareOptions,
  prepareCredentials,
  readProducerDigests,
  reconcilePreparedEnvironment,
  startAPI,
  targetBinding,
  verifyFixedProducer,
  waitForHTTP,
} from './realm-v3-full-data-live-services.mjs';
export function buildCleanupReceipt(input) {
  validateLiveEnvironmentAttestation(input.attestation);
  assertSHA256(input.runInputDigest, 'runInputDigest');
  assertSHA256(input.closeCandidateDigest, 'closeCandidateDigest');
  const requiredTrue = [
    ['api.stopped', input.api?.stopped],
    ['api.pidAbsent', input.api?.pidAbsent],
    ['disposableDatabase.deleted', input.disposableDatabase?.deleted],
    ['redis.removed', input.redis?.removed],
    ['persistentParity.unchanged', input.persistentParity?.unchanged],
    ['writeBoundary.unchanged', input.writeBoundary?.unchanged],
  ];
  for (const [label, value] of requiredTrue) {
    if (value !== true) fail('cleanup_incomplete', `${label} is not proven`);
  }
  if (
    input.disposableDatabase.residue !== 0 ||
    input.redis.keysAfterCleanup !== 0 ||
    input.redis.containerResidue !== 0 ||
    Object.values(input.temporaryResidue).some((value) => value !== 0) ||
    input.persistentParity.worldCharactersBefore !== 470 ||
    input.persistentParity.worldCharactersAfter !== 470 ||
    input.persistentParity.personaCharactersBefore !== 1 ||
    input.persistentParity.personaCharactersAfter !== 1 ||
    input.writeBoundary.rootWrites !== 0 ||
    input.writeBoundary.nimiWrites !== 0 ||
    input.writeBoundary.appsWrites !== 0
  ) {
    fail('cleanup_incomplete', 'cleanup receipt contains residue or persistent/write-boundary drift');
  }
  const value = {
    schemaVersion: CLEANUP_SCHEMA,
    status: 'PASS',
    reasonCode: 'passed',
    environmentAttestationDigest: input.attestation.contentHash,
    runInputDigest: input.runInputDigest,
    closeCandidateDigest: input.closeCandidateDigest,
    api: input.api,
    disposableDatabase: input.disposableDatabase,
    redis: input.redis,
    temporaryResidue: input.temporaryResidue,
    persistentParity: input.persistentParity,
    writeBoundary: input.writeBoundary,
  };
  value.contentHash = domainHash(CLEANUP_SCHEMA, value);
  validateLiveEnvironmentCleanupReceipt(value, {
    environmentAttestationDigest: input.attestation.contentHash,
    runInputDigest: input.runInputDigest,
    closeCandidateDigest: input.closeCandidateDigest,
  });
  return value;
}

async function normalizeStateOnlyOptions(rawOptions, outputKey) {
  if (!path.isAbsolute(rawOptions.stateDirectory || '')) fail('unsafe_state_directory', 'state-dir must be absolute');
  const nimiRoot = await realpath(MODULE_NIMI_ROOT);
  const rootRealm = await realpath(path.dirname(nimiRoot));
  if (rawOptions.rootRealm) {
    const requestedRoot = await realpath(rawOptions.rootRealm);
    if (requestedRoot !== rootRealm) {
      fail('cleanup_identity_mismatch', 'state operation Root Realm differs from the executing repository');
    }
  }
  const stateDirectory = await assertSafeStateDirectoryTarget(
    rawOptions.stateDirectory,
    [rootRealm, nimiRoot],
  );
  const info = await lstat(stateDirectory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700) {
    fail('unsafe_state_directory', 'state-dir identity/mode is invalid');
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    fail('unsafe_state_directory', 'state-dir owner changed');
  }
  if (outputKey && !path.isAbsolute(rawOptions[outputKey])) fail('invalid_output', `${outputKey} must be absolute`);
  if (outputKey) {
    const output = path.resolve(rawOptions[outputKey]);
    if (output === stateDirectory || isInside(stateDirectory, output)) fail('invalid_output', `${outputKey} must remain outside state-dir`);
  }
  return {
    ...rawOptions,
    rootRealm,
    nimiRoot,
    stateDirectory,
    ...(outputKey ? { [outputKey]: path.resolve(rawOptions[outputKey]) } : {}),
  };
}

export function validateRunLockBinding(runLock) {
  if (!runLock || typeof runLock !== 'object' || Array.isArray(runLock)) fail('invalid_run_lock', 'run lock is invalid');
  if (runLock.schemaVersion !== 'nimi.realm-v3-full-data-run-lock/v1') {
    fail('invalid_run_lock', 'run lock schema is not current');
  }
  assertSHA256(runLock.inputDigest, 'run lock inputDigest');
  const digestInput = { ...runLock };
  delete digestInput.inputDigest;
  if (domainHash(runLock.schemaVersion, digestInput) !== runLock.inputDigest) {
    fail('invalid_run_lock', 'run lock input digest does not cover its content');
  }
  return runLock;
}

export function validateCloseCandidateBinding(candidate, runInputDigest, environmentAttestationDigest) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail('invalid_close_candidate', 'close candidate is invalid');
  }
  const expectedKeys = new Set([
    'schemaVersion',
    'status',
    'reasonCode',
    'inputDigest',
    'liveEnvironmentAttestationDigest',
    'aggregateCandidateDigest',
    'acceptance',
    'contentHash',
  ]);
  if (Object.keys(candidate).some((key) => !expectedKeys.has(key)) || Object.keys(candidate).length !== expectedKeys.size) {
    fail('invalid_close_candidate', 'close candidate is not a closed object');
  }
  if (
    candidate.schemaVersion !== CLOSE_CANDIDATE_SCHEMA ||
    candidate.status !== 'PASS' ||
    candidate.reasonCode !== 'passed' ||
    candidate.inputDigest !== runInputDigest ||
    candidate.liveEnvironmentAttestationDigest !== environmentAttestationDigest
  ) {
    fail('invalid_close_candidate', 'close candidate identity/verdict binding mismatch');
  }
  assertSHA256(candidate.aggregateCandidateDigest, 'close candidate aggregateCandidateDigest');
  const acceptanceKeys = [
    'total',
    'passed',
    'failed',
    'skipped',
    'orphanProductRecords',
    'rawTransportResidue',
    'externalCleanup',
  ];
  if (
    !candidate.acceptance || typeof candidate.acceptance !== 'object' || Array.isArray(candidate.acceptance) ||
    canonicalJSONStringify(Object.keys(candidate.acceptance).sort()) !== canonicalJSONStringify([...acceptanceKeys].sort()) ||
    candidate.acceptance.total !== 471 || candidate.acceptance.passed !== 471 ||
    candidate.acceptance.failed !== 0 || candidate.acceptance.skipped !== 0 ||
    candidate.acceptance.orphanProductRecords !== 0 || candidate.acceptance.rawTransportResidue !== 0 ||
    candidate.acceptance.externalCleanup !== 'pending'
  ) {
    fail('invalid_close_candidate', 'close candidate acceptance is not exact 471/471 with pending external cleanup');
  }
  assertSHA256(candidate.contentHash, 'close candidate contentHash');
  const digestInput = { ...candidate };
  delete digestInput.contentHash;
  if (domainHash(CLOSE_CANDIDATE_SCHEMA, digestInput) !== candidate.contentHash) {
    fail('invalid_close_candidate', 'close candidate content hash mismatch');
  }
  return candidate;
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('cleanup_receipt_mismatch', `${label} is not an object`);
  }
  if (canonicalJSONStringify(Object.keys(value).sort()) !== canonicalJSONStringify([...keys].sort())) {
    fail('cleanup_receipt_mismatch', `${label} is not a closed object`);
  }
}

export function validateLiveEnvironmentCleanupReceipt(receipt, expected) {
  assertExactKeys(receipt, [
    'schemaVersion',
    'status',
    'reasonCode',
    'environmentAttestationDigest',
    'runInputDigest',
    'closeCandidateDigest',
    'api',
    'disposableDatabase',
    'redis',
    'temporaryResidue',
    'persistentParity',
    'writeBoundary',
    'contentHash',
  ], 'cleanup receipt');
  assertExactKeys(receipt.api, ['stopped', 'pidAbsent', 'processIdentityDigest'], 'cleanup receipt.api');
  assertExactKeys(receipt.disposableDatabase, ['databaseNameHash', 'deleted', 'residue'], 'cleanup receipt.disposableDatabase');
  assertExactKeys(receipt.redis, ['keysBeforeCleanup', 'keysAfterCleanup', 'removed', 'containerResidue'], 'cleanup receipt.redis');
  assertExactKeys(receipt.temporaryResidue, ['export', 'state', 'custody', 'keyMaterial', 'apiProcess'], 'cleanup receipt.temporaryResidue');
  assertExactKeys(receipt.persistentParity, [
    'database',
    'snapshotDigestBefore',
    'snapshotDigestAfter',
    'worldCharactersBefore',
    'worldCharactersAfter',
    'personaCharactersBefore',
    'personaCharactersAfter',
    'unchanged',
    'readOnly',
  ], 'cleanup receipt.persistentParity');
  assertExactKeys(receipt.writeBoundary, [
    'rootWrites',
    'nimiWrites',
    'appsWrites',
    'beforeDigest',
    'afterDigest',
    'unchanged',
  ], 'cleanup receipt.writeBoundary');
  if (
    receipt?.schemaVersion !== CLEANUP_SCHEMA || receipt.status !== 'PASS' || receipt.reasonCode !== 'passed' ||
    receipt.environmentAttestationDigest !== expected.environmentAttestationDigest ||
    receipt.runInputDigest !== expected.runInputDigest ||
    receipt.closeCandidateDigest !== expected.closeCandidateDigest
  ) {
    fail('cleanup_receipt_mismatch', 'cleanup receipt identity binding mismatch');
  }
  for (const [label, digest] of [
    ['environmentAttestationDigest', receipt.environmentAttestationDigest],
    ['runInputDigest', receipt.runInputDigest],
    ['closeCandidateDigest', receipt.closeCandidateDigest],
    ['api.processIdentityDigest', receipt.api.processIdentityDigest],
    ['disposableDatabase.databaseNameHash', receipt.disposableDatabase.databaseNameHash],
    ['persistentParity.snapshotDigestBefore', receipt.persistentParity.snapshotDigestBefore],
    ['persistentParity.snapshotDigestAfter', receipt.persistentParity.snapshotDigestAfter],
    ['writeBoundary.beforeDigest', receipt.writeBoundary.beforeDigest],
    ['writeBoundary.afterDigest', receipt.writeBoundary.afterDigest],
  ]) assertSHA256(digest, `cleanup receipt.${label}`);
  if (
    receipt.api.stopped !== true || receipt.api.pidAbsent !== true ||
    receipt.disposableDatabase.deleted !== true || receipt.disposableDatabase.residue !== 0 ||
    receipt.redis.removed !== true || receipt.redis.keysAfterCleanup !== 0 || receipt.redis.containerResidue !== 0 ||
    Object.values(receipt.temporaryResidue).some((value) => value !== 0) ||
    receipt.persistentParity.database !== PERSISTENT_DATABASE ||
    receipt.persistentParity.worldCharactersBefore !== 470 || receipt.persistentParity.worldCharactersAfter !== 470 ||
    receipt.persistentParity.personaCharactersBefore !== 1 || receipt.persistentParity.personaCharactersAfter !== 1 ||
    receipt.persistentParity.unchanged !== true || receipt.persistentParity.readOnly !== true ||
    receipt.persistentParity.snapshotDigestBefore !== receipt.persistentParity.snapshotDigestAfter ||
    receipt.writeBoundary.rootWrites !== 0 || receipt.writeBoundary.nimiWrites !== 0 || receipt.writeBoundary.appsWrites !== 0 ||
    receipt.writeBoundary.unchanged !== true || receipt.writeBoundary.beforeDigest !== receipt.writeBoundary.afterDigest
  ) {
    fail('cleanup_receipt_mismatch', 'cleanup receipt does not prove zero residue and immutable persistent/write boundary');
  }
  assertSHA256(receipt.contentHash, 'cleanup receipt contentHash');
  const digestInput = { ...receipt };
  delete digestInput.contentHash;
  if (domainHash(CLEANUP_SCHEMA, digestInput) !== receipt.contentHash) {
    fail('cleanup_receipt_mismatch', 'cleanup receipt content hash mismatch');
  }
  return receipt;
}

async function loadBoundState(options) {
  const statePath = path.join(options.stateDirectory, 'state.json');
  const markerPath = path.join(options.stateDirectory, 'owner-marker.json');
  await assertPrivateRegularFile(statePath, 'live environment state');
  await assertPrivateRegularFile(markerPath, 'live environment owner marker');
  const state = await readJSON(statePath, 'live environment state');
  const marker = await readJSON(markerPath, 'live environment owner marker');
  const expectedTargetKeys = [
    'rootRealm',
    'nimiRoot',
    'dependencyRoot',
    'stateDirectory',
    'attestationOutput',
    'childRegistrationPath',
    'persistentPostgresContainer',
    'postgresUser',
    'redisImage',
    'apiPort',
  ];
  if (
    state.schemaVersion !== STATE_SCHEMA || marker.schemaVersion !== MARKER_SCHEMA ||
    state.environmentId !== marker.environmentId || state.targetDigest !== marker.targetDigest ||
    state.stateDirectory !== options.stateDirectory || !DISPOSABLE_DATABASE_RE.test(state.disposableDatabase) ||
    state.rootRealm !== options.rootRealm || state.nimiRoot !== options.nimiRoot ||
    !path.isAbsolute(state.childRegistrationPath || '') ||
    !state.wrapperTrust || !state.executionTargets ||
    !state.target ||
    canonicalJSONStringify(Object.keys(state.target).sort()) !==
      canonicalJSONStringify([...expectedTargetKeys].sort()) ||
    typeof state.executionTargets.persistentPostgresContainer !== 'string' ||
    typeof state.executionTargets.postgresUser !== 'string' ||
    marker.ownerUid !== (typeof process.getuid === 'function' ? process.getuid() : null)
  ) {
    fail('cleanup_identity_mismatch', 'state-dir marker/state identity is invalid');
  }
  const target = state.target;
  const canonicalDependencyRoot = await realpath(target.dependencyRoot);
  const canonicalRegistrationPath = await realpath(target.childRegistrationPath);
  const canonicalAttestationOutput = await assertAdmittedEvidenceOutput(
    options.rootRealm,
    target.attestationOutput,
    'live-environment-attestation.json',
  );
  if (
    target.rootRealm !== options.rootRealm || target.nimiRoot !== options.nimiRoot ||
    target.dependencyRoot !== canonicalDependencyRoot ||
    target.stateDirectory !== options.stateDirectory ||
    target.attestationOutput !== canonicalAttestationOutput ||
    target.childRegistrationPath !== canonicalRegistrationPath ||
    state.childRegistrationPath !== canonicalRegistrationPath ||
    state.executionTargets.persistentPostgresContainer !== target.persistentPostgresContainer ||
    state.executionTargets.postgresUser !== target.postgresUser ||
    (options.persistentPostgresContainer &&
      options.persistentPostgresContainer !== target.persistentPostgresContainer) ||
    (options.postgresUser && options.postgresUser !== target.postgresUser) ||
    (options.redisImage && options.redisImage !== target.redisImage) ||
    (options.attestationPath && path.resolve(options.attestationPath) !== target.attestationOutput)
  ) fail('cleanup_identity_mismatch', 'state target binding differs from its canonical targets');
  assertSafeName(target.persistentPostgresContainer, 'persistent PostgreSQL container');
  assertSafeName(target.postgresUser, 'PostgreSQL user');
  const trust = await captureWrapperTrust(options.nimiRoot, canonicalRegistrationPath);
  if (canonicalJSONStringify(trust.sanitized) !== canonicalJSONStringify(state.wrapperTrust)) {
    fail('wrapper_identity_drift', 'state trusted tool/wrapper closure changed');
  }
  const recomputedTargetDigest = domainHash(
    'nimi.realm-v3-full-data-live-environment-target/v1',
    targetBinding({ ...target, wrapperTrust: trust }),
  );
  if (recomputedTargetDigest !== state.targetDigest || recomputedTargetDigest !== marker.targetDigest) {
    fail('cleanup_identity_mismatch', 'state target digest does not match canonical current targets');
  }
  activateWrapperToolClosure(trust);
  return state;
}

async function revalidateStateDirectoryBeforeRemoval(options, expectedState) {
  const canonical = await assertSafeStateDirectoryTarget(
    options.stateDirectory,
    [options.rootRealm, options.nimiRoot],
  );
  if (canonical !== options.stateDirectory) {
    fail('cleanup_identity_mismatch', 'state-dir canonical identity changed before removal');
  }
  const rebound = await loadBoundState(options);
  if (
    rebound.environmentId !== expectedState.environmentId ||
    rebound.targetDigest !== expectedState.targetDigest ||
    rebound.stateDirectory !== expectedState.stateDirectory
  ) fail('cleanup_identity_mismatch', 'state-dir owner binding changed before removal');
}

async function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function stopBoundAPI(state) {
  if (!state.api?.pid || !state.api?.processIdentity?.digest) fail('cleanup_identity_mismatch', 'API state identity is missing');
  if (!(await processExists(state.api.pid))) {
    return { stopped: true, pidAbsent: true, processIdentityDigest: state.api.processIdentity.digest };
  }
  const current = await captureProcessIdentity(state.api.pid);
  if (current.digest !== state.api.processIdentity.digest) fail('cleanup_identity_mismatch', 'API pid was reused by another process');
  try {
    process.kill(-state.api.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && await processExists(state.api.pid)) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  if (await processExists(state.api.pid)) {
    process.kill(-state.api.pid, 'SIGKILL');
  }
  const killDeadline = Date.now() + 5_000;
  while (Date.now() < killDeadline && await processExists(state.api.pid)) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  if (await processExists(state.api.pid)) fail('api_cleanup_failed', 'API process still exists after cleanup');
  return { stopped: true, pidAbsent: true, processIdentityDigest: state.api.processIdentity.digest };
}

async function cleanupRedis(state) {
  if (!REDIS_CONTAINER_RE.test(state.redis?.name) || !/^[0-9a-f]{64}$/u.test(state.redis?.id || '')) {
    fail('cleanup_identity_mismatch', 'Redis target identity is unsafe');
  }
  const intent = state.resources?.redisIntent;
  if (!intent) fail('cleanup_identity_mismatch', 'Redis durable intent is missing');
  let observation = await observeRedis(intent);
  if (!observation) {
    return { keysBeforeCleanup: null, keysAfterCleanup: 0, removed: true, containerResidue: 0 };
  }
  const classification = classifyPreparedRedisObservation(observation, intent, state.redis);
  if (classification === 'foreign' || classification === 'absent') {
    fail('cleanup_identity_mismatch', 'Redis container identity/label changed');
  }
  if (classification === 'restart') {
    await runCapture('docker', ['start', state.redis.name]);
    observation = await observeRedis(intent);
    if (classifyPreparedRedisObservation(observation, intent, state.redis) !== 'healthy') {
      fail('cleanup_identity_mismatch', 'Redis stopped identity could not be safely recovered for cleanup');
    }
  }
  const keysBeforeCleanup = Number((await runCapture('docker', ['exec', state.redis.name, 'redis-cli', 'DBSIZE'])).stdout.trim());
  if (!Number.isSafeInteger(keysBeforeCleanup) || keysBeforeCleanup < 0) fail('redis_cleanup_failed', 'Redis key count invalid');
  if (keysBeforeCleanup > 0) await runCapture('docker', ['exec', state.redis.name, 'redis-cli', 'FLUSHALL', 'SYNC']);
  const keysAfterCleanup = Number((await runCapture('docker', ['exec', state.redis.name, 'redis-cli', 'DBSIZE'])).stdout.trim());
  if (keysAfterCleanup !== 0) fail('redis_cleanup_failed', 'isolated Redis is not empty');
  await runCapture('docker', ['rm', '-f', state.redis.name]);
  let residue = 0;
  try {
    await runCapture('docker', ['inspect', state.redis.name]);
    residue = 1;
  } catch {
    residue = 0;
  }
  if (residue !== 0) fail('redis_cleanup_failed', 'isolated Redis container remains');
  return { keysBeforeCleanup, keysAfterCleanup, removed: true, containerResidue: 0 };
}

async function cleanupAPIFromDurableIntent(state) {
  const intent = state.resources?.apiIntent;
  const hadRecordedAPI = Boolean(state.api);
  let proof = hadRecordedAPI
    ? await stopBoundAPI(state)
    : { stopped: true, pidAbsent: true, processIdentityDigest: sha256Hex(intent?.intentDigest || 'not-created') };
  if (!intent) return proof;
  const recoveredPID = await findAPIProcessByIntent(intent);
  if (recoveredPID !== null) {
    if (
      hadRecordedAPI || state.resources?.apiLaunch?.status !== 'starting' ||
      state.resources.apiLaunch.pid !== null ||
      state.resources.apiLaunch.processIdentityDigest !== null ||
      state.resources.apiLaunch.processIntentDigest !== intent.intentDigest
    ) fail('cleanup_identity_mismatch', 'unrecorded API marker process is not an adoptable durable launch');
    const processIdentity = await captureProcessIdentity(recoveredPID);
    proof = await stopBoundAPI({ api: { pid: recoveredPID, processIdentity } });
  }
  if (await findAPIProcessByIntent(intent) !== null) {
    fail('api_cleanup_failed', 'API process marker remains after cleanup');
  }
  return proof;
}

async function cleanupRedisFromDurableIntent(state) {
  if (state.redis) return cleanupRedis(state);
  const intent = state.resources?.redisIntent;
  if (!intent) return { keysBeforeCleanup: null, keysAfterCleanup: 0, removed: true, containerResidue: 0 };
  let observation = await observeRedis(intent);
  if (!observation) return { keysBeforeCleanup: null, keysAfterCleanup: 0, removed: true, containerResidue: 0 };
  if (
    !/^[0-9a-f]{64}$/u.test(observation.id) ||
    observation.imageIdentity !== intent.imageIdentity || observation.label !== intent.environmentId
  ) {
    fail('cleanup_identity_mismatch', 'Redis recovered from durable intent has a foreign identity');
  }
  if (!observation.running) {
    await runCapture('docker', ['start', intent.name]);
    observation = await observeRedis(intent);
  }
  if (!observation?.running || !Number.isSafeInteger(observation.port)) {
    fail('cleanup_identity_mismatch', 'Redis recovered from durable intent has no safe loopback port');
  }
  return cleanupRedis({
    ...state,
    redis: { name: intent.name, id: observation.id, port: observation.port },
  });
}

async function cleanupPartialLiveEnvironment(rawOptions) {
  assertNoAmbientChildInjection();
  const options = await normalizeStateOnlyOptions(rawOptions, null);
  const state = await loadBoundState(options);
  await verifyAndActivateStateToolClosure(state);
  if (state.phase === 'prepared') {
    fail('cleanup_binding_missing', 'prepared environment cleanup requires attestation/run-lock/close-candidate/receipt-out');
  }
  const statePath = path.join(options.stateDirectory, 'state.json');
  state.cleanup ??= {};
  state.cleanup.api ??= await cleanupAPIFromDurableIntent(state);
  await writePrivateJSON(statePath, state);
  state.cleanup.redis ??= await cleanupRedisFromDurableIntent(state);
  await writePrivateJSON(statePath, state);
  let persistentAfter = null;
  if (state.persistent) {
    persistentAfter = await readDatabaseSnapshot(
      state.target.persistentPostgresContainer,
      state.target.postgresUser,
      PERSISTENT_DATABASE,
      1,
    );
    if (
      persistentAfter.snapshotDigest !== state.persistent.snapshotDigest ||
      persistentAfter.worldSourceSetDigest !== state.persistent.worldSourceSetDigest ||
      persistentAfter.containerIdentityDigest !== state.persistent.containerIdentityDigest
    ) {
      fail('persistent_database_drift', 'persistent nimi_dev changed during partial cleanup');
    }
  }
  const databaseIntent = state.resources?.databaseIntent;
  if (databaseIntent) {
    await dropDisposableDatabase(
      state.target.persistentPostgresContainer,
      state.target.postgresUser,
      databaseIntent.database,
      databaseIntent.marker,
    );
  }
  let boundaryAfter = null;
  if (state.writeBoundary) {
    boundaryAfter = await captureWriteBoundary(state.target.rootRealm);
    if (
      canonicalJSONStringify(boundaryDigests(boundaryAfter)) !==
      canonicalJSONStringify(boundaryDigests(state.writeBoundary))
    ) {
      fail('write_boundary_drift', 'Root/Nimi/nimi-apps changed during partial cleanup');
    }
  }
  await verifyAndActivateStateToolClosure(state);
  const result = {
    schemaVersion: 'nimi.realm-v3-full-data-live-environment-partial-cleanup/v1',
    status: 'ABORTED',
    reasonCode: 'partial_environment_cleaned',
    environmentIdHash: sha256Hex(state.environmentId),
    phase: state.phase,
    apiResidue: 0,
    redisResidue: 0,
    disposableDatabaseResidue: 0,
    temporaryStateResidue: 0,
    persistentUnchanged: state.persistent ? persistentAfter.snapshotDigest === state.persistent.snapshotDigest : true,
    writeBoundaryUnchanged: state.writeBoundary
      ? canonicalJSONStringify(boundaryDigests(boundaryAfter)) === canonicalJSONStringify(boundaryDigests(state.writeBoundary))
      : true,
  };
  result.contentHash = domainHash(result.schemaVersion, result);
  await revalidateStateDirectoryBeforeRemoval(options, state);
  await rm(options.stateDirectory, { recursive: true, force: false });
  await syncDirectory(path.dirname(options.stateDirectory));
  if (await pathExists(options.stateDirectory)) fail('state_cleanup_failed', 'partial state-dir still exists');
  return result;
}

export async function cleanupLiveEnvironment(rawOptions) {
  assertNoAmbientChildInjection();
  const finalBindingNames = ['attestationPath', 'runLockPath', 'closeCandidatePath', 'receiptOutput'];
  const suppliedFinalBindings = finalBindingNames.filter((name) => typeof rawOptions[name] === 'string' && rawOptions[name] !== '');
  if (suppliedFinalBindings.length === 0) return cleanupPartialLiveEnvironment(rawOptions);
  if (suppliedFinalBindings.length !== finalBindingNames.length) {
    fail('cleanup_binding_missing', 'final cleanup requires all attestation/run-lock/close-candidate/receipt-out bindings');
  }
  for (const [label, value] of [
    ['state-dir', rawOptions.stateDirectory],
    ['receipt-out', rawOptions.receiptOutput],
    ['attestation', rawOptions.attestationPath],
    ['run-lock', rawOptions.runLockPath],
    ['close-candidate', rawOptions.closeCandidatePath],
  ]) {
    if (!path.isAbsolute(value || '')) fail('invalid_input', `${label} path must be absolute`);
  }
  const canonicalRootRealm = await realpath(rawOptions.rootRealm);
  const receiptOutput = await assertAdmittedEvidenceOutput(
    canonicalRootRealm,
    rawOptions.receiptOutput,
    'live-environment-cleanup-receipt.json',
  );
  const canonicalAttestationPath = await assertAdmittedEvidenceOutput(
    canonicalRootRealm,
    rawOptions.attestationPath,
    'live-environment-attestation.json',
  );
  const pendingReceipt = `${receiptOutput}.pending`;
  await assertPrivateRegularFile(canonicalAttestationPath, 'cleanup live attestation');
  const attestationInput = await readRegularJSONInput(canonicalAttestationPath, 'live attestation');
  const runLockInput = await readRegularJSONInput(rawOptions.runLockPath, 'run lock');
  const closeCandidateInput = await readRegularJSONInput(rawOptions.closeCandidatePath, 'close candidate');
  const attestation = validateLiveEnvironmentAttestation(attestationInput.value);
  const runLock = validateRunLockBinding(runLockInput.value);
  const closeCandidate = validateCloseCandidateBinding(
    closeCandidateInput.value,
    runLock.inputDigest,
    attestation.contentHash,
  );
  const expectedReceipt = {
    environmentAttestationDigest: attestation.contentHash,
    runInputDigest: runLock.inputDigest,
    closeCandidateDigest: closeCandidate.contentHash,
  };
  try {
    const existing = await readRegularJSONInput(receiptOutput, 'cleanup receipt');
    await assertPrivateRegularFile(receiptOutput, 'existing cleanup receipt');
    return validateLiveEnvironmentCleanupReceipt(existing.value, expectedReceipt);
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'invalid_input') throw error;
  }
  try {
    const pending = await readRegularJSONInput(pendingReceipt, 'pending cleanup receipt');
    await assertPrivateRegularFile(pendingReceipt, 'pending cleanup receipt');
    const receipt = validateLiveEnvironmentCleanupReceipt(pending.value, expectedReceipt);
    try {
      await lstat(rawOptions.stateDirectory);
      fail('cleanup_receipt_mismatch', 'pending cleanup receipt exists while state-dir remains');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await durableRename(pendingReceipt, receiptOutput);
    return receipt;
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'invalid_input') throw error;
  }
  const options = await normalizeStateOnlyOptions(
    { ...rawOptions, rootRealm: canonicalRootRealm, receiptOutput },
    'receiptOutput',
  );
  const state = await loadBoundState(options);
  const cleanupTrust = await verifyAndActivateStateToolClosure(state);
  if (state.phase !== 'prepared') fail('cleanup_identity_mismatch', 'only a fully prepared environment can issue a final cleanup receipt');
  const attestationPath = attestationInput.path;
  if (attestationPath !== state.attestationPath) {
    fail('cleanup_identity_mismatch', 'cleanup attestation path differs from bound state');
  }
  if (attestation.contentHash !== state.attestationDigest) fail('cleanup_identity_mismatch', 'live attestation digest changed');
  if (canonicalJSONStringify(attestation.wrapper) !== canonicalJSONStringify(cleanupTrust.sanitized)) {
    fail('wrapper_identity_drift', 'cleanup attestation trusted tool/wrapper closure changed');
  }
  const statePath = path.join(options.stateDirectory, 'state.json');
  state.cleanup ??= {};
  const api = state.cleanup.api ?? await cleanupAPIFromDurableIntent(state);
  state.cleanup.api = api;
  await writePrivateJSON(statePath, state);
  const redis = state.cleanup.redis ?? await cleanupRedis(state);
  state.cleanup.redis = redis;
  await writePrivateJSON(statePath, state);
  const persistentAfter = state.cleanup.persistentAfter ?? await readDatabaseSnapshot(
      state.target.persistentPostgresContainer,
      state.target.postgresUser,
      PERSISTENT_DATABASE,
      1,
    );
  state.cleanup.persistentAfter = persistentAfter;
  await writePrivateJSON(statePath, state);
  const persistentUnchanged =
    persistentAfter.snapshotDigest === state.persistent.snapshotDigest &&
    persistentAfter.worldSourceSetDigest === state.persistent.worldSourceSetDigest &&
    persistentAfter.containerIdentityDigest === state.persistent.containerIdentityDigest;
  if (!persistentUnchanged) fail('persistent_database_drift', 'persistent nimi_dev changed during N7');
  if (!state.cleanup.databaseDeleted) {
    await dropDisposableDatabase(
      state.target.persistentPostgresContainer,
      state.target.postgresUser,
      state.disposableDatabase,
      state.resources.databaseIntent.marker,
    );
    state.cleanup.databaseDeleted = true;
    await writePrivateJSON(statePath, state);
  } else if ((await databaseExists(
    state.target.persistentPostgresContainer,
    state.target.postgresUser,
    state.disposableDatabase,
  )).exists) {
    fail('database_cleanup_failed', 'disposable database reappeared after cleanup');
  }
  const boundaryAfter = state.cleanup.boundaryAfter ?? await captureWriteBoundary(state.target.rootRealm);
  state.cleanup.boundaryAfter = boundaryAfter;
  await writePrivateJSON(statePath, state);
  const boundaryUnchanged = canonicalJSONStringify(boundaryDigests(boundaryAfter)) === canonicalJSONStringify(boundaryDigests(state.writeBoundary));
  if (!boundaryUnchanged) fail('write_boundary_drift', 'Root/Nimi/nimi-apps write boundary changed');
  const cleanupTrustAfter = await captureWrapperTrust(state.nimiRoot, state.childRegistrationPath);
  if (canonicalJSONStringify(cleanupTrustAfter.sanitized) !== canonicalJSONStringify(cleanupTrust.sanitized)) {
    fail('wrapper_identity_drift', 'trusted tool/wrapper closure changed during cleanup');
  }
  const receipt = buildCleanupReceipt({
    attestation,
    runInputDigest: runLock.inputDigest,
    closeCandidateDigest: closeCandidate.contentHash,
    api,
    disposableDatabase: {
      databaseNameHash: sha256Hex(state.disposableDatabase),
      deleted: true,
      residue: 0,
    },
    redis,
    temporaryResidue: {
      export: 0,
      state: 0,
      custody: 0,
      keyMaterial: 0,
      apiProcess: 0,
    },
    persistentParity: {
      database: PERSISTENT_DATABASE,
      snapshotDigestBefore: state.persistent.snapshotDigest,
      snapshotDigestAfter: persistentAfter.snapshotDigest,
      worldCharactersBefore: 470,
      worldCharactersAfter: 470,
      personaCharactersBefore: 1,
      personaCharactersAfter: 1,
      unchanged: true,
      readOnly: true,
    },
    writeBoundary: {
      rootWrites: 0,
      nimiWrites: 0,
      appsWrites: 0,
      beforeDigest: domainHash('nimi.realm-v3-full-data-write-boundary/v1', boundaryDigests(state.writeBoundary)),
      afterDigest: domainHash('nimi.realm-v3-full-data-write-boundary/v1', boundaryDigests(boundaryAfter)),
      unchanged: true,
    },
  });
  await writePrivateJSON(pendingReceipt, receipt);
  await revalidateStateDirectoryBeforeRemoval(options, state);
  await rm(options.stateDirectory, { recursive: true, force: false });
  await syncDirectory(path.dirname(options.stateDirectory));
  try {
    await lstat(options.stateDirectory);
    fail('state_cleanup_failed', 'state-dir still exists');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await durableRename(pendingReceipt, options.receiptOutput);
  return receipt;
}


export {
  assertExactKeys,
  cleanupAPIFromDurableIntent,
  cleanupPartialLiveEnvironment,
  cleanupRedis,
  cleanupRedisFromDurableIntent,
  loadBoundState,
  normalizeStateOnlyOptions,
  processExists,
  revalidateStateDirectoryBeforeRemoval,
  stopBoundAPI,
};

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
  CURRENT_ACCESS_POLICY_DIGEST,
  CURRENT_OPENAPI_DIGEST,
  DISPOSABLE_DATABASE_RE,
  EVIDENCE_RELATIVE_ROOT,
  EXECUTION_RECEIPT_SCHEMA,
  FIXED_PERSONA_ID,
  FIXED_REALM_COMMIT,
  FIXED_REALM_TREE,
  FIXTURE_SOURCE_PATH,
  LIVE_ENVIRONMENT_MODULE_BASENAMES,
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

import {
  assertExactKeys,
  buildCleanupReceipt,
  cleanupAPIFromDurableIntent,
  cleanupLiveEnvironment,
  cleanupPartialLiveEnvironment,
  cleanupRedis,
  cleanupRedisFromDurableIntent,
  loadBoundState,
  normalizeStateOnlyOptions,
  processExists,
  revalidateStateDirectoryBeforeRemoval,
  stopBoundAPI,
  validateCloseCandidateBinding,
  validateLiveEnvironmentCleanupReceipt,
  validateRunLockBinding,
} from './realm-v3-full-data-live-cleanup.mjs';

export {
  ATTESTATION_SCHEMA,
  CHILD_REGISTRATION_SCHEMA,
  CLEANUP_SCHEMA,
  CLOSE_CANDIDATE_SCHEMA,
  CURRENT_ACCESS_POLICY_DIGEST,
  CURRENT_OPENAPI_DIGEST,
  DISPOSABLE_DATABASE_RE,
  EVIDENCE_RELATIVE_ROOT,
  EXECUTION_RECEIPT_SCHEMA,
  FIXED_PERSONA_ID,
  FIXED_REALM_COMMIT,
  FIXED_REALM_TREE,
  FIXTURE_SOURCE_PATH,
  LIVE_ENVIRONMENT_MODULE_BASENAMES,
  MARKER_SCHEMA,
  MATERIALIZER_ACCOUNT_ID,
  N6_FROZEN_EVIDENCE_RELATIVE_PATH,
  PERSISTENT_DATABASE,
  STATE_DIRECTORY_RE,
  STATE_SCHEMA,
  assertAdmittedEvidenceOutput,
  assertDisposableDatabaseName,
  assertSafeStateDirectoryTarget,
  canonicalJSONStringify,
  domainHash,
  sha256Hex,
  validateLiveChildRegistration,
  validateLiveEnvironmentAttestation,
  validateLiveEnvironmentExecutionReceipt,
} from './realm-v3-full-data-live-contract.mjs';
import {
  boundaryDigests,
  captureRepositoryBoundary,
  captureWriteBoundary,
} from './realm-v3-full-data-live-attestation.mjs';
export {
  buildLiveEnvironmentAttestation,
  buildServerExportAttestationDigest,
  validateLiveEnvironmentAttestationBinding,
} from './realm-v3-full-data-live-attestation.mjs';
export { prepareLiveEnvironment } from './realm-v3-full-data-live-prepare.mjs';
export {
  buildCleanupReceipt,
  cleanupLiveEnvironment,
  validateCloseCandidateBinding,
  validateLiveEnvironmentCleanupReceipt,
  validateRunLockBinding,
} from './realm-v3-full-data-live-cleanup.mjs';
export async function statusLiveEnvironment(rawOptions) {
  const options = await normalizeStateOnlyOptions(rawOptions, null);
  const state = await loadBoundState(options);
  if (state.phase === 'prepared') await assertPrivateRegularFile(state.attestationPath, 'status live attestation');
  const attestation = state.phase === 'prepared'
    ? validateLiveEnvironmentAttestation(await readJSON(state.attestationPath, 'live attestation'))
    : null;
  let health = state.phase === 'prepared' ? 'healthy' : 'recoverable';
  let reasonCode = state.phase === 'prepared' ? 'prepared_healthy' : 'preparation_incomplete';
  if (attestation) {
    try {
      if (attestation.contentHash !== state.attestationDigest) {
        fail('resume_identity_mismatch', 'status attestation digest changed');
      }
      const n6Baseline = await readFrozenN6Baseline(state.nimiRoot);
      if (canonicalJSONStringify(n6Baseline) !== canonicalJSONStringify(state.n6Baseline)) {
        fail('n6_baseline_mismatch', 'status frozen N6 baseline changed');
      }
      const persistent = await readDatabaseSnapshot(
        state.target.persistentPostgresContainer,
        state.target.postgresUser,
        PERSISTENT_DATABASE,
        1,
      );
      assertPersistentMatchesFrozenN6(persistent, n6Baseline);
      const disposableIdentity = await databaseExists(
        state.target.persistentPostgresContainer,
        state.target.postgresUser,
        state.disposableDatabase,
      );
      if (
        !disposableIdentity.exists ||
        disposableIdentity.marker !== state.resources.databaseIntent?.marker
      ) fail('resume_identity_mismatch', 'status disposable database marker changed');
      const disposable = await readDatabaseSnapshot(
        state.target.persistentPostgresContainer,
        state.target.postgresUser,
        state.disposableDatabase,
        1,
      );
      if (
        persistent.snapshotDigest !== state.persistent.snapshotDigest ||
        disposable.snapshotDigest !== attestation.disposable.snapshotDigest ||
        canonicalJSONStringify(persistent.worlds) !== canonicalJSONStringify(disposable.worlds) ||
        canonicalJSONStringify(disposable.personas[0]) !==
          canonicalJSONStringify(n6Baseline.personaSourceRef)
      ) fail('resume_identity_mismatch', 'status source database parity changed');
      const boundary = await captureWriteBoundary(state.rootRealm);
      if (
        canonicalJSONStringify(boundaryDigests(boundary)) !==
        canonicalJSONStringify(boundaryDigests(state.writeBoundary))
      ) fail('write_boundary_drift', 'status write boundary changed');
      const dependency = await dependencyRootDigest(state.target.dependencyRoot);
      if (
        dependency.digest !== state.export.dependencyRootDigest ||
        dependency.storeDirectoryPathHash !== state.export.offlineStoreDirectoryPathHash ||
        await hashFile(state.export.archivePath) !== state.export.archiveSha256 ||
        await hashFile(path.join(state.export.exportRoot, FIXTURE_SOURCE_PATH)) !==
          state.export.fixtureSourceSha256
      ) fail('runtime_dependency_drift', 'status fixed export/dependency input changed');
      await assertRuntimeDependencyClosure(state.export);
      await assertPrivateRegularFile(state.credentials.custodyPath, 'status credential custody');

      const redisObservation = await observeRedis(state.resources.redisIntent);
      const redisClassification = classifyPreparedRedisObservation(
        redisObservation,
        state.resources.redisIntent,
        state.redis,
      );
      if (['absent', 'foreign'].includes(redisClassification)) {
        fail('resume_identity_mismatch', `status Redis is ${redisClassification}`);
      }

      const apiIntent = await buildAPIIntent(state, state.credentials);
      if (canonicalJSONStringify(apiIntent) !== canonicalJSONStringify(state.resources.apiIntent)) {
        fail('resume_identity_mismatch', 'status API process intent changed');
      }
      assertPreparedAPIStateBinding(state, apiIntent);
      const apiExists = Boolean(state.api?.pid && await processExists(state.api.pid));
      const apiIdentity = apiExists ? await captureProcessIdentity(state.api.pid) : null;
      const markerPID = await findAPIProcessByIntent(apiIntent);
      const apiClassification = classifyPreparedAPIObservation({
        recorded: state.api,
        launch: state.resources.apiLaunch,
        markerPID,
        recordedProcessExists: apiExists,
        identityMatches: Boolean(apiIdentity && apiIdentity.digest === state.api?.processIdentity?.digest),
      });
      if (apiClassification === 'foreign') {
        fail('resume_identity_mismatch', 'status API marker/PID is foreign');
      }
      if (redisClassification === 'restart' || ['restart', 'adopt'].includes(apiClassification)) {
        health = 'recoverable';
        reasonCode = 'prepared_recovery_required';
      }
    } catch (error) {
      health = 'unhealthy';
      reasonCode = String(error?.code || 'prepared_reconciliation_failed');
    }
  }
  return {
    schemaVersion: 'nimi.realm-v3-full-data-live-environment-status/v1',
    phase: state.phase,
    environmentIdHash: sha256Hex(state.environmentId),
    disposableDatabaseNameHash: sha256Hex(state.disposableDatabase),
    attestationDigest: attestation?.contentHash ?? null,
    health,
    reasonCode,
    resumable: health !== 'unhealthy',
  };
}

export async function execInLiveEnvironment(rawOptions, command, args) {
  assertNoAmbientChildInjection();
  const options = await normalizeStateOnlyOptions(rawOptions, 'executionReceiptOutput');
  const state = await loadBoundState(options);
  if (state.phase !== 'prepared') fail('environment_not_ready', 'live environment is not prepared');
  const statePath = path.join(options.stateDirectory, 'state.json');
  await reconcilePreparedEnvironment(
    state,
    {
      ...state.target,
      wrapperTrust: { sanitized: state.wrapperTrust },
      attestationOutput: state.attestationPath,
    },
    statePath,
  );
  if (!['census', 'partition'].includes(rawOptions.stage)) {
    fail('invalid_exec', 'exec stage must be census or partition');
  }
  if (!SAFE_EXECUTION_PARTITION_RE.test(rawOptions.partition || '')) {
    fail('invalid_exec', 'exec partition identity is unsafe');
  }
  const receiptOutput = await assertAdmittedEvidenceOutput(
    state.rootRealm,
    options.executionReceiptOutput,
    'live-environment-execution-receipt.json',
  );
  if (await pathExists(receiptOutput)) {
    fail('unsafe_evidence_output', 'exec refuses to overwrite an existing execution receipt');
  }
  const childIOEnvironment = rawOptions.stage === 'census'
    ? {
        request: 'NIMI_REALM_V3_FULL_CENSUS_REQUEST_PATH',
        receipt: 'NIMI_REALM_V3_FULL_CENSUS_RECEIPT_PATH',
      }
    : {
        request: 'NIMI_REALM_V3_FULL_PARTITION_REQUEST_PATH',
        receipt: 'NIMI_REALM_V3_FULL_PARTITION_RECEIPT_PATH',
      };
  const childRequestPath = await assertAdmittedEvidencePath(
    state.rootRealm,
    process.env[childIOEnvironment.request],
    'live child request',
  );
  const childReceiptPath = await assertAdmittedEvidencePath(
    state.rootRealm,
    process.env[childIOEnvironment.receipt],
    'live child product receipt',
  );
  await assertPrivateRegularFile(childRequestPath, 'live child request');
  if (await pathExists(childReceiptPath)) {
    fail('unsafe_evidence_output', 'exec refuses a pre-existing child product receipt');
  }
  const canonicalAttestationPath = await assertAdmittedEvidenceOutput(
    state.rootRealm,
    state.attestationPath,
    'live-environment-attestation.json',
  );
  if (canonicalAttestationPath !== state.attestationPath) {
    fail('resume_identity_mismatch', 'exec attestation path is not canonical');
  }
  await assertPrivateRegularFile(state.attestationPath, 'exec live attestation');
  const attestation = validateLiveEnvironmentAttestation(await readJSON(state.attestationPath, 'live attestation'));
  if (attestation.contentHash !== state.attestationDigest) {
    fail('resume_identity_mismatch', 'exec attestation digest differs from prepared state');
  }
  if (!command || command.includes('\0') || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
    fail('invalid_exec', 'exec command/arguments are invalid');
  }

  // Recompute the complete wrapper/registration/child closure before custody is read.
  const preTrust = await captureWrapperTrust(state.nimiRoot, state.childRegistrationPath);
  if (
    canonicalJSONStringify(preTrust.sanitized) !== canonicalJSONStringify(state.wrapperTrust) ||
    canonicalJSONStringify(preTrust.sanitized) !== canonicalJSONStringify(attestation.wrapper)
  ) {
    fail('wrapper_identity_drift', 'exec wrapper identity differs from prepared attestation');
  }
  activateWrapperToolClosure(preTrust);
  const registered = preTrust.registration.children.find((entry) => entry.sanitized.stage === rawOptions.stage);
  if (!registered) fail('invalid_exec', 'exec stage has no registered child');
  const registeredArgs = registered.raw.kind === 'node_script'
    ? [registered.raw.script, ...registered.raw.args]
    : registered.raw.args;
  if (
    command !== registered.raw.command ||
    canonicalJSONStringify(args) !== canonicalJSONStringify(registeredArgs)
  ) {
    fail('invalid_exec', 'exec command/arguments differ from the closed child registration');
  }

  const preAPIProcessIntentDigest = state.api.processIntentDigest;
  const preAPIGeneration = state.api.generation;
  const preAPIProcessIdentityDigest = state.api.processIdentity.digest;
  const preRuntimeDependencyClosureDigest = state.export.runtimeDependencyClosureDigest;

  await assertPrivateRegularFile(state.credentials.custodyPath, 'exec credential custody');
  const custody = await readJSON(state.credentials.custodyPath, 'credential custody');
  if (custody.oauth?.accountID !== MATERIALIZER_ACCOUNT_ID) fail('account_mismatch', 'custody account changed');
  const child = spawn(command, args, {
    cwd: state.nimiRoot,
    env: {
      ...sanitizedChildBaseEnvironment(),
      [childIOEnvironment.request]: childRequestPath,
      [childIOEnvironment.receipt]: childReceiptPath,
      NIMI_REALM_V3_LIVE_BASE_URL: attestation.service.canonicalRealmBaseURL,
      NIMI_REALM_V3_LIVE_TOKEN_URL: attestation.service.canonicalTokenURL,
      NIMI_REALM_V3_LIVE_BEARER: custody.oauth.accessToken,
      NIMI_REALM_V3_LIVE_REFRESH_TOKEN: custody.oauth.refreshToken,
      NIMI_REALM_V3_LIVE_ACCESS_EXPIRES_AT: custody.oauth.accessExpiresAt,
      NIMI_REALM_V3_LIVE_ACCOUNT_ID: custody.oauth.accountID,
      NIMI_REALM_V3_LIVE_EXPECTED_ISSUER: attestation.service.expectedIssuer,
      NIMI_REALM_V3_LIVE_POLICY_DIGEST: attestation.producer.policyDigest,
      NIMI_REALM_V3_FULL_LIVE_ENVIRONMENT_ATTESTATION_PATH: state.attestationPath,
      NIMI_REALM_V3_FULL_CENSUS_PERSISTENT_POSTGRES_CONTAINER:
        state.executionTargets.persistentPostgresContainer,
      NIMI_REALM_V3_FULL_CENSUS_DISPOSABLE_POSTGRES_CONTAINER:
        state.executionTargets.persistentPostgresContainer,
      NIMI_REALM_V3_FULL_CENSUS_DATABASE_USER: state.executionTargets.postgresUser,
      NIMI_REALM_V3_FULL_CENSUS_PERSISTENT_DATABASE: PERSISTENT_DATABASE,
      NIMI_REALM_V3_FULL_CENSUS_DISPOSABLE_DATABASE: state.disposableDatabase,
      NIMI_REALM_V3_FULL_DOCKER_EXECUTABLE:
        preTrust.registration.tools.docker.canonicalPath,
    },
    shell: false,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const execution = await new Promise((resolvePromise) => {
    let settled = false;
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      resolvePromise({ exitCode: null, signal: null, spawnErrorCode: String(error?.code || 'unknown') });
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      resolvePromise({ exitCode: code, signal, spawnErrorCode: null });
    });
  });

  let postTrust = null;
  let postIdentityFailure = null;
  try {
    postTrust = await captureWrapperTrust(state.nimiRoot, state.childRegistrationPath);
  } catch (error) {
    postIdentityFailure = String(error?.code || 'wrapper_identity_invalid');
  }
  const postRegistered = postTrust?.registration.children.find(
    (entry) => entry.sanitized.stage === rawOptions.stage,
  );
  const invalidPostDigest = domainHash('nimi.realm-v3-full-data-live-untrusted-post-identity/v1', {
    stage: rawOptions.stage,
    reason: postIdentityFailure || 'registered_child_missing',
  });
  const postWrapperIdentityDigest = postTrust?.sanitized.wrapperIdentityDigest ?? invalidPostDigest;
  const postChildIdentityDigest = postRegistered?.sanitized.childIdentityDigest ?? invalidPostDigest;
  let postAPIProcessIdentityDigest = invalidPostDigest;
  let postAPIFailure = null;
  try {
    await assertRuntimeDependencyClosure(state.export);
    const postState = await readJSON(statePath, 'post-execution live environment state');
    if (
      postState.phase !== 'prepared' || postState.api?.generation !== preAPIGeneration ||
      postState.api?.processIntentDigest !== preAPIProcessIntentDigest ||
      postState.api?.pid !== state.api.pid || !(await processExists(state.api.pid))
    ) fail('api_identity_drift', 'API durable generation changed during live child execution');
    const postAPIIdentity = await captureProcessIdentity(state.api.pid);
    postAPIProcessIdentityDigest = postAPIIdentity.digest;
  } catch (error) {
    postAPIFailure = String(error?.code || 'api_identity_drift');
  }
  const identityUnchanged =
    postWrapperIdentityDigest === preTrust.sanitized.wrapperIdentityDigest &&
    postChildIdentityDigest === registered.sanitized.childIdentityDigest &&
    postAPIProcessIdentityDigest === preAPIProcessIdentityDigest &&
    postAPIFailure === null;
  const status = execution.spawnErrorCode === null && execution.exitCode === 0 &&
    execution.signal === null && identityUnchanged
    ? 'PASS'
    : 'FAIL';
  const reasonCode = status === 'PASS'
    ? 'passed'
    : !identityUnchanged
      ? 'identity_drift'
      : execution.spawnErrorCode !== null
        ? 'spawn_failed'
        : 'child_failed';
  const receipt = {
    schemaVersion: EXECUTION_RECEIPT_SCHEMA,
    status,
    reasonCode,
    environmentAttestationDigest: attestation.contentHash,
    wrapperIdentityDigest: preTrust.sanitized.wrapperIdentityDigest,
    childRegistrationDigest: preTrust.sanitized.childRegistrationDigest,
    stage: rawOptions.stage,
    partitionIdHash: sha256Hex(rawOptions.partition),
    executionReceiptPathHash: sha256Hex(receiptOutput),
    childIdentityDigest: registered.sanitized.childIdentityDigest,
    argsDigest: domainHash('nimi.realm-v3-full-data-live-execution-args/v1', args),
    exitCode: execution.exitCode,
    signal: execution.signal,
    preExecutionWrapperIdentityDigest: preTrust.sanitized.wrapperIdentityDigest,
    postExecutionWrapperIdentityDigest: postWrapperIdentityDigest,
    preExecutionChildIdentityDigest: registered.sanitized.childIdentityDigest,
    postExecutionChildIdentityDigest: postChildIdentityDigest,
    apiProcessIntentDigest: preAPIProcessIntentDigest,
    apiGeneration: preAPIGeneration,
    apiProcessIdentityDigest: preAPIProcessIdentityDigest,
    postExecutionAPIProcessIdentityDigest: postAPIProcessIdentityDigest,
    apiIdentityUnchanged: postAPIProcessIdentityDigest === preAPIProcessIdentityDigest && postAPIFailure === null,
    runtimeDependencyClosureDigest: preRuntimeDependencyClosureDigest,
    identityUnchanged,
  };
  receipt.contentHash = domainHash(EXECUTION_RECEIPT_SCHEMA, receipt);
  validateLiveEnvironmentExecutionReceipt(receipt, {
    environmentAttestationDigest: attestation.contentHash,
    wrapperIdentityDigest: preTrust.sanitized.wrapperIdentityDigest,
    childRegistrationDigest: preTrust.sanitized.childRegistrationDigest,
    stage: rawOptions.stage,
    partitionIdHash: sha256Hex(rawOptions.partition),
    executionReceiptPathHash: sha256Hex(receiptOutput),
    childIdentityDigest: registered.sanitized.childIdentityDigest,
    apiProcessIntentDigest: preAPIProcessIntentDigest,
    apiGeneration: preAPIGeneration,
    apiProcessIdentityDigest: preAPIProcessIdentityDigest,
    runtimeDependencyClosureDigest: preRuntimeDependencyClosureDigest,
  });
  await writePrivateJSON(receiptOutput, receipt);
  if (status !== 'PASS') {
    fail('live_execution_failed', `live environment child failed with ${reasonCode}`);
  }
  return receipt;
}

export const __test = {
  activateTrustedToolPaths,
  assertNoAmbientChildInjection,
  boundaryDigests,
  captureRepositoryBoundary,
  captureTrustedFileIdentity,
  captureWrapperTrust,
  classifyPreparedAPIObservation,
  classifyPreparedRedisObservation,
  classifyInterruptedPersonaRecovery,
  cleanupAPIFromDurableIntent,
  deriveDisposableDatabaseURL,
  ensurePrivateDirectory,
  normalizeStateOnlyOptions,
  parseOfflineStoreDirectory,
  readFrozenN6Baseline,
  runtimeDependencyClosureManifest,
  targetBinding,
  writePrivateJSON,
};

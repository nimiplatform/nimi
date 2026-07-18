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
  buildLiveEnvironmentAttestation,
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
export async function prepareLiveEnvironment(rawOptions) {
  assertNoAmbientChildInjection();
  const options = await normalizePrepareOptions(rawOptions);
  activateWrapperToolClosure(options.wrapperTrust);
  await ensurePrivateDirectory(options.stateDirectory);
  const statePath = path.join(options.stateDirectory, 'state.json');
  const markerPath = path.join(options.stateDirectory, 'owner-marker.json');
  const binding = targetBinding(options);
  const targetDigest = domainHash('nimi.realm-v3-full-data-live-environment-target/v1', binding);
  const canonicalTarget = {
    rootRealm: options.rootRealm,
    nimiRoot: options.nimiRoot,
    dependencyRoot: options.dependencyRoot,
    stateDirectory: options.stateDirectory,
    attestationOutput: options.attestationOutput,
    childRegistrationPath: options.childRegistrationPath,
    persistentPostgresContainer: options.persistentPostgresContainer,
    postgresUser: options.postgresUser,
    redisImage: options.redisImage,
    apiPort: options.apiPort ?? null,
  };
  let state;
  const stateExists = await pathExists(statePath);
  const markerExists = await pathExists(markerPath);
  if (stateExists !== markerExists) {
    fail('resume_identity_mismatch', 'state-dir has an incomplete marker/state pair');
  }
  if (!stateExists && await pathExists(options.attestationOutput)) {
    fail('unsafe_evidence_output', 'prepare refuses to overwrite an unbound live attestation');
  }
  if (stateExists) {
    state = await readJSON(statePath, 'live environment state');
    const marker = await readJSON(markerPath, 'live environment owner marker');
    if (
      state.schemaVersion !== STATE_SCHEMA || marker.schemaVersion !== MARKER_SCHEMA ||
      state.targetDigest !== targetDigest || marker.targetDigest !== targetDigest ||
      marker.environmentId !== state.environmentId ||
      state.rootRealm !== options.rootRealm || state.nimiRoot !== options.nimiRoot ||
      state.childRegistrationPath !== options.childRegistrationPath ||
      canonicalJSONStringify(state.target) !== canonicalJSONStringify(canonicalTarget) ||
      state.executionTargets?.persistentPostgresContainer !== options.persistentPostgresContainer ||
      state.executionTargets?.postgresUser !== options.postgresUser ||
      canonicalJSONStringify(state.wrapperTrust) !== canonicalJSONStringify(options.wrapperTrust.sanitized)
    ) {
      fail('resume_identity_mismatch', 'state-dir marker does not bind the requested targets');
    }
    if (state.phase === 'prepared') {
      return reconcilePreparedEnvironment(state, options, statePath);
    }
  } else {
    const environmentId = randomBytes(16).toString('hex');
    state = {
      schemaVersion: STATE_SCHEMA,
      environmentId,
      stateDirectory: options.stateDirectory,
      rootRealm: options.rootRealm,
      nimiRoot: options.nimiRoot,
      childRegistrationPath: options.childRegistrationPath,
      wrapperTrust: options.wrapperTrust.sanitized,
      executionTargets: {
        persistentPostgresContainer: options.persistentPostgresContainer,
        postgresUser: options.postgresUser,
      },
      target: canonicalTarget,
      targetDigest,
      phase: 'initialized',
      disposableDatabase: `nimi_realm_v3_n7_${environmentId}`,
      resources: {},
    };
    await writePrivateJSON(markerPath, {
      schemaVersion: MARKER_SCHEMA,
      environmentId,
      targetDigest,
      ownerUid: typeof process.getuid === 'function' ? process.getuid() : null,
    });
    await writePrivateJSON(statePath, state);
  }
  assertDisposableDatabaseName(state.disposableDatabase);
  if (state.cleanup) fail('resume_identity_mismatch', 'prepare cannot resume an environment whose cleanup has started');
  const personaIntent = declaredPersonaProvisioningIntent(state);
  if (
    state.resources.personaIntent &&
    canonicalJSONStringify(state.resources.personaIntent) !== canonicalJSONStringify(personaIntent)
  ) {
    fail('resume_identity_mismatch', 'Persona provisioning intent changed');
  }
  if (state.phase === 'persona_provisioning_started' && !state.personaProvisioningPath) {
    state.resources.personaIntent ??= personaIntent;
    await writePrivateJSON(statePath, state);
  }
  const recoverInterruptedPersona = Boolean(
    state.resources.personaIntent && !state.personaProvisioningPath,
  );
  await verifyFixedProducer(options.rootRealm);
  const producer = await readProducerDigests(options.rootRealm);
  const observedN6Baseline = await readFrozenN6Baseline(options.nimiRoot);
  if (
    state.n6Baseline &&
    canonicalJSONStringify(state.n6Baseline) !== canonicalJSONStringify(observedN6Baseline)
  ) {
    fail('n6_baseline_mismatch', 'frozen N6 evidence identity changed while prepare was resumable');
  }
  state.n6Baseline ??= observedN6Baseline;
  const observedWriteBoundary = await captureWriteBoundary(options.rootRealm);
  if (
    state.writeBoundary &&
    canonicalJSONStringify(boundaryDigests(state.writeBoundary)) !==
      canonicalJSONStringify(boundaryDigests(observedWriteBoundary))
  ) {
    fail('write_boundary_drift', 'Root/Nimi/nimi-apps changed while prepare was resumable');
  }
  const writeBoundary = state.writeBoundary ?? observedWriteBoundary;
  const observedPersistent = await readDatabaseSnapshot(
    options.persistentPostgresContainer,
    options.postgresUser,
    PERSISTENT_DATABASE,
    1,
  );
  assertPersistentMatchesFrozenN6(observedPersistent, state.n6Baseline);
  if (
    state.persistent &&
    (
      state.persistent.snapshotDigest !== observedPersistent.snapshotDigest ||
      state.persistent.worldSourceSetDigest !== observedPersistent.worldSourceSetDigest ||
      state.persistent.containerIdentityDigest !== observedPersistent.containerIdentityDigest
    )
  ) {
    fail('persistent_database_drift', 'persistent nimi_dev changed while prepare was resumable');
  }
  const persistent = state.persistent ?? observedPersistent;
  state.persistent ??= persistent;
  state.writeBoundary ??= writeBoundary;
  state.phase = 'persistent_verified';
  await writePrivateJSON(statePath, state);

  const databaseMarker = `nimi.realm-v3-full-data:${state.environmentId}:${state.targetDigest}`;
  const declaredDatabaseIntent = {
    database: state.disposableDatabase,
    marker: databaseMarker,
    identityDigest: domainHash('nimi.realm-v3-full-data-database-resource/v1', {
      database: state.disposableDatabase,
      marker: databaseMarker,
    }),
  };
  if (
    state.resources.databaseIntent &&
    canonicalJSONStringify(state.resources.databaseIntent) !== canonicalJSONStringify(declaredDatabaseIntent)
  ) {
    fail('resume_identity_mismatch', 'disposable database intent changed');
  }
  state.resources.databaseIntent ??= declaredDatabaseIntent;
  state.phase = 'database_declared';
  await writePrivateJSON(statePath, state);
  await createDisposableClone(
    options.persistentPostgresContainer,
    options.postgresUser,
    state.disposableDatabase,
    databaseMarker,
  );
  const cloneExpectedPersonas = state.personaProvisioningPath
    ? 1
    : recoverInterruptedPersona
      ? [0, 1]
      : 1;
  const cloned = await readDatabaseSnapshot(
    options.persistentPostgresContainer,
    options.postgresUser,
    state.disposableDatabase,
    cloneExpectedPersonas,
  );
  if (canonicalJSONStringify(persistent.worlds) !== canonicalJSONStringify(cloned.worlds)) {
    fail('clone_parity_mismatch', 'disposable clone differs from persistent 470 World baseline');
  }
  const interruptedPersonaRecovery = recoverInterruptedPersona
    ? classifyInterruptedPersonaRecovery(cloned.personas, state.n6Baseline.personaSourceRef)
    : null;
  state.resources.databaseCreated = true;
  state.phase = 'database_cloned';
  await writePrivateJSON(statePath, state);

  const exportIntent = {
    archivePath: path.join(options.stateDirectory, 'realm-current.tar'),
    exportRoot: path.join(options.stateDirectory, 'realm-current-export'),
    producerCommit: FIXED_REALM_COMMIT,
    producerTree: FIXED_REALM_TREE,
  };
  exportIntent.intentDigest = domainHash('nimi.realm-v3-full-data-export-resource/v1', exportIntent);
  if (
    state.resources.exportIntent &&
    canonicalJSONStringify(state.resources.exportIntent) !== canonicalJSONStringify(exportIntent)
  ) {
    fail('resume_identity_mismatch', 'fixed Realm export intent changed');
  }
  state.resources.exportIntent ??= exportIntent;
  state.phase = 'server_export_declared';
  await writePrivateJSON(statePath, state);
  if (!state.export) {
    await rm(exportIntent.archivePath, { force: true });
    await rm(exportIntent.exportRoot, { recursive: true, force: true });
    state.export = await exportAndBuildFixedRealm(state, options);
  }
  else {
    for (const field of [
      'archiveSha256',
      'manifestDigest',
      'buildArtifactDigest',
      'dependencyRootDigest',
      'offlineStoreDirectoryPathHash',
      'runtimeDependencyClosureDigest',
      'fixtureSourceSha256',
    ]) {
      assertSHA256(state.export[field], `resumed export.${field}`);
    }
    if (
      !Number.isSafeInteger(state.export.runtimeDependencyFileCount) ||
      state.export.runtimeDependencyFileCount < 1 ||
      !Number.isSafeInteger(state.export.runtimeDependencySymlinkCount) ||
      state.export.runtimeDependencySymlinkCount < 0
    ) fail('resume_identity_mismatch', 'resumed runtime dependency closure counts are invalid');
    const currentDependency = await dependencyRootDigest(options.dependencyRoot);
    if (
      await hashFile(state.export.archivePath) !== state.export.archiveSha256 ||
      await hashFile(path.join(state.export.exportRoot, FIXTURE_SOURCE_PATH)) !== state.export.fixtureSourceSha256 ||
      currentDependency.digest !== state.export.dependencyRootDigest ||
      currentDependency.storeDirectoryPathHash !== state.export.offlineStoreDirectoryPathHash
    ) {
      fail('resume_identity_mismatch', 'fixed Realm export changed during resume');
    }
    await assertPrivateRegularFile(
      state.export.runtimeDependencyClosureManifestPath,
      'runtime dependency closure manifest',
    );
    const frozenClosureManifest = await readJSON(
      state.export.runtimeDependencyClosureManifestPath,
      'runtime dependency closure manifest',
    );
    if (
      domainHash(frozenClosureManifest.schemaVersion, frozenClosureManifest) !==
      state.export.runtimeDependencyClosureDigest
    ) fail('runtime_dependency_drift', 'runtime dependency closure manifest changed');
    await assertRuntimeDependencyClosure(state.export);
  }
  state.phase = 'server_built';
  await writePrivateJSON(statePath, state);

  const redisIntent = await buildRedisIntent(state.environmentId, options.redisImage);
  if (
    state.resources.redisIntent &&
    canonicalJSONStringify(state.resources.redisIntent) !== canonicalJSONStringify(redisIntent)
  ) {
    fail('resume_identity_mismatch', 'isolated Redis intent changed');
  }
  state.resources.redisIntent ??= redisIntent;
  state.phase = 'redis_declared';
  await writePrivateJSON(statePath, state);
  const observedRedis = await startRedis(state.resources.redisIntent, {
    allowCreate: state.resources.redisCreated !== true,
  });
  state.redis = observedRedis;
  state.resources.redisCreated = true;
  state.phase = 'redis_started';
  await writePrivateJSON(statePath, state);

  const persistentDatabaseURL = String(process.env.NIMI_REALM_V3_FULL_LIVE_PERSISTENT_DATABASE_URL || '').trim();
  if (!persistentDatabaseURL) fail('missing_database_url', 'NIMI_REALM_V3_FULL_LIVE_PERSISTENT_DATABASE_URL is required');
  const disposableDatabaseURL = deriveDisposableDatabaseURL(persistentDatabaseURL, state.disposableDatabase);
  const credentialsIntent = await buildCredentialsIntent(state, options);
  if (
    state.resources.credentialsIntent &&
    canonicalJSONStringify(state.resources.credentialsIntent) !== canonicalJSONStringify(credentialsIntent)
  ) {
    fail('resume_identity_mismatch', 'credential custody intent changed');
  }
  state.resources.credentialsIntent ??= credentialsIntent;
  state.phase = 'credentials_declared';
  await writePrivateJSON(statePath, state);
  let credentials;
  if (state.credentials) {
    await assertPrivateRegularFile(state.credentials.custodyPath, 'credential custody');
    const custody = await readJSON(state.credentials.custodyPath, 'credential custody');
    credentials = { ...state.credentials, custody };
  } else {
    credentials = await prepareCredentials(
      state,
      options,
      disposableDatabaseURL,
      state.redis,
      state.resources.credentialsIntent,
    );
    state.credentials = { ...state.resources.credentialsIntent };
  }
  if (
    credentials.custody.accountID !== MATERIALIZER_ACCOUNT_ID ||
    credentials.custody.apiEnvironment?.JWT_ISSUER !== credentials.apiBaseURL ||
    credentials.custody.apiEnvironment?.DATABASE_URL !== disposableDatabaseURL ||
    credentials.custody.apiEnvironment?.TEST_DATABASE_URL !== disposableDatabaseURL
  ) {
    fail('resume_identity_mismatch', 'credential custody authority binding changed');
  }
  state.phase = 'credentials_prepared';
  await writePrivateJSON(statePath, state);

  const apiIntent = await buildAPIIntent({ ...state, stateDirectory: options.stateDirectory }, credentials);
  if (
    state.resources.apiIntent &&
    canonicalJSONStringify(state.resources.apiIntent) !== canonicalJSONStringify(apiIntent)
  ) {
    fail('resume_identity_mismatch', 'API process intent changed');
  }
  state.resources.apiIntent ??= apiIntent;
  state.phase = 'api_declared';
  await writePrivateJSON(statePath, state);
  state.api = await startAPI(
    state,
    credentials,
    state.resources.apiIntent,
    statePath,
  );
  state.resources.apiStarted = true;
  state.phase = 'api_started';
  await writePrivateJSON(statePath, state);

  let oauth = credentials.custody.oauth;
  if (!oauth) {
    oauth = await establishFormalOAuthSession(credentials.apiBaseURL, credentials.custody.bootstrapAccessToken);
    credentials.custody.oauth = oauth;
    delete credentials.custody.bootstrapAccessToken;
    await writePrivateJSON(credentials.custodyPath, credentials.custody);
  }
  if (
    oauth.accountID !== MATERIALIZER_ACCOUNT_ID ||
    typeof oauth.accessToken !== 'string' ||
    typeof oauth.refreshToken !== 'string'
  ) {
    fail('resume_identity_mismatch', 'formal OAuth custody changed during resume');
  }
  state.materializerAccountIdHash = sha256Hex(oauth.accountID);
  state.phase = 'oauth_established';
  await writePrivateJSON(statePath, state);

  let personaResult;
  if (state.personaProvisioningPath) {
    await assertPrivateRegularFile(state.personaProvisioningPath, 'Persona provisioning result');
    personaResult = {
      outputPath: state.personaProvisioningPath,
      persona: await readJSON(state.personaProvisioningPath, 'Persona provisioning result'),
    };
  } else if (
    recoverInterruptedPersona &&
    ['rerun', 'replace'].includes(interruptedPersonaRecovery)
  ) {
    state.resources.personaIntent = personaIntent;
    state.phase = 'persona_provisioning_started';
    await writePrivateJSON(statePath, state);
    personaResult = await createFormalPersona(state, credentials, disposableDatabaseURL);
  } else {
    state.resources.personaIntent = personaIntent;
    state.phase = 'persona_provisioning_started';
    await writePrivateJSON(statePath, state);
    personaResult = await createFormalPersona(state, credentials, disposableDatabaseURL);
  }
  state.personaProvisioningPath = personaResult.outputPath;
  state.phase = 'persona_provisioned';
  await writePrivateJSON(statePath, state);
  const disposable = await readDatabaseSnapshot(
    options.persistentPostgresContainer,
    options.postgresUser,
    state.disposableDatabase,
    1,
  );
  const [disposablePersona] = disposable.personas;
  if (
    disposablePersona.id !== 'persona-character-0716-fullchain-fixture' ||
    disposablePersona.ownerAccountId !== MATERIALIZER_ACCOUNT_ID ||
    canonicalJSONStringify(disposablePersona) !== canonicalJSONStringify(personaResult.persona)
  ) {
    fail('persona_provisioning_failed', 'disposable Persona differs from the current Realm fixture result');
  }
  const persistentAfterPreparation = await readDatabaseSnapshot(
    options.persistentPostgresContainer,
    options.postgresUser,
    PERSISTENT_DATABASE,
    1,
  );
  assertPersistentMatchesFrozenN6(persistentAfterPreparation, state.n6Baseline);
  if (
    persistentAfterPreparation.snapshotDigest !== persistent.snapshotDigest ||
    persistentAfterPreparation.instanceDigest !== persistent.instanceDigest
  ) fail('persistent_database_drift', 'persistent nimi_dev changed during environment preparation');
  const completedWriteBoundary = await captureWriteBoundary(options.rootRealm);
  if (
    canonicalJSONStringify(boundaryDigests(completedWriteBoundary)) !==
    canonicalJSONStringify(boundaryDigests(writeBoundary))
  ) fail('write_boundary_drift', 'Root/Nimi/nimi-apps changed during environment preparation');
  await assertRuntimeDependencyClosure(state.export);
  const completedWrapperTrust = await captureWrapperTrust(
    options.nimiRoot,
    options.childRegistrationPath,
  );
  if (
    canonicalJSONStringify(completedWrapperTrust.sanitized) !==
    canonicalJSONStringify(options.wrapperTrust.sanitized)
  ) {
    fail('wrapper_identity_drift', 'trusted tool/wrapper closure changed during prepare');
  }
  activateWrapperToolClosure(completedWrapperTrust);

  const attestation = buildLiveEnvironmentAttestation({
    environmentId: state.environmentId,
    producer,
    export: state.export,
    canonicalRealmBaseURL: credentials.apiBaseURL,
    canonicalTokenURL: `${credentials.apiBaseURL}/api/auth/oauth/token`,
    expectedIssuer: credentials.apiBaseURL,
    materializerAccountIdHash: state.materializerAccountIdHash,
    persistent,
    disposable,
    disposableDatabase: state.disposableDatabase,
    persistentContainerIdentityDigest: persistent.containerIdentityDigest,
    disposableContainerIdentityDigest: disposable.containerIdentityDigest,
    fixtureSourceSha256: state.export.fixtureSourceSha256,
    n6Baseline: state.n6Baseline,
    redis: state.redis.proof,
    api: state.api.proof,
    custody: {
      directoryDigest: sha256Hex(options.stateDirectory),
      mode: 'state-dir:0700/files:0600',
      secretFieldsInAttestation: false,
    },
    wrapper: completedWrapperTrust.sanitized,
    writeBoundary,
  });
  await writePrivateJSON(options.attestationOutput, attestation);
  state.attestationPath = options.attestationOutput;
  state.attestationDigest = attestation.contentHash;
  state.disposableInstanceDigest = disposable.instanceDigest;
  state.phase = 'prepared';
  await writePrivateJSON(statePath, state);
  return { state, attestation, resumed: false };
}

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
  producerAPIExecutionPaths,
  readDatabaseSnapshot,
  readFrozenOfflineStoreDirectory,
  reconcilePreparedRedis,
  relativeExecutionPath,
  reserveLoopbackPort,
  runtimeDependencyClosureManifest,
  sourceRowsSQL,
  startRedis,
} from './realm-v3-full-data-live-infrastructure.mjs';
async function buildCredentialsIntent(state, options) {
  const apiPort = state.resources.credentialsIntent?.apiPort ?? options.apiPort ?? await reserveLoopbackPort();
  const apiBaseURL = `http://127.0.0.1:${apiPort}`;
  const helperPath = path.join(state.export.exportRoot, '.nimi-n7-current-realm-fixture-helper.mts');
  const custodyPath = path.join(options.stateDirectory, 'custody.json');
  return {
    apiPort,
    apiBaseURL,
    helperPath,
    custodyPath,
    intentDigest: domainHash('nimi.realm-v3-full-data-credential-resource/v1', {
      environmentId: state.environmentId,
      apiPort,
      apiBaseURL,
      helperPathHash: sha256Hex(helperPath),
      custodyPathHash: sha256Hex(custodyPath),
    }),
  };
}

async function prepareCredentials(state, options, disposableDatabaseURL, redis, intent) {
  const helperPath = intent.helperPath;
  const fixedModuleURL = pathToFileURL(path.join(state.export.exportRoot, FIXTURE_SOURCE_PATH)).href;
  await writeFile(helperPath, fixedFixtureHelperSource(fixedModuleURL), { mode: 0o600 });
  const inputPath = path.join(options.stateDirectory, 'credentials.input.json');
  const outputPath = intent.custodyPath;
  const rawOutputPath = `${outputPath}.fixture-raw`;
  const apiPort = intent.apiPort;
  const apiBaseURL = intent.apiBaseURL;
  if (await pathExists(outputPath)) {
    await assertPrivateRegularFile(outputPath, 'credential custody');
    const custody = await readJSON(outputPath, 'credential custody');
    return { helperPath, custodyPath: outputPath, custody, apiPort, apiBaseURL };
  }
  await writePrivateJSON(inputPath, {
    databaseURL: disposableDatabaseURL,
    apiPort,
    apiBaseURL,
    environmentOverrides: {
      REDIS_URL: `redis://127.0.0.1:${redis.port}`,
      NIMI_REALM_URL: apiBaseURL,
      NIMI_WEB_URL: apiBaseURL,
      REALM_ENVIRONMENT_ID: `realm-v3-full-data-${state.environmentId}`,
      OAUTH_AUTHORIZATION_CODE_HMAC_SECRET: randomBytes(32).toString('base64url'),
      NIMI_EMBEDDING_MODE: 'none',
    },
  });
  await rm(rawOutputPath, { force: true });
  await runCapture(process.execPath, ['--import', 'tsx', helperPath, 'credentials', inputPath, rawOutputPath], {
    cwd: state.export.exportRoot,
    env: closedProcessEnvironment(),
  });
  await rm(inputPath, { force: true });
  await assertPrivateRegularFile(rawOutputPath, 'raw credential custody');
  const custody = await readJSON(rawOutputPath, 'credential custody');
  await rm(rawOutputPath, { force: true });
  if (custody.accountID !== MATERIALIZER_ACCOUNT_ID || typeof custody.bootstrapAccessToken !== 'string') {
    fail('credential_provisioning_failed', 'current Realm fixture credentials are invalid');
  }
  await writePrivateJSON(outputPath, custody);
  return { helperPath, custodyPath: outputPath, custody, apiPort, apiBaseURL };
}

async function buildAPIIntent(state, credentials) {
  const producerAPI = await producerAPIExecutionPaths(state.export);
  const entry = producerAPI.entry;
  const entrySha256 = await hashFile(entry);
  const logPath = path.join(state.stateDirectory, 'realm-api.log');
  const marker = `realm-v3-full-data-api-${state.environmentId}`;
  const loopbackPort = Number(new URL(credentials.apiBaseURL).port);
  if (!Number.isSafeInteger(loopbackPort) || loopbackPort < 1 || loopbackPort > 65535) {
    fail('invalid_api_port', 'API intent loopback port is invalid');
  }
  const authority = {
    entryPathHash: sha256Hex(entry),
    workingDirectoryHash: sha256Hex(producerAPI.packageRoot),
    entrySha256,
    logPathHash: sha256Hex(logPath),
    markerHash: sha256Hex(marker),
    canonicalRealmBaseURLHash: sha256Hex(credentials.apiBaseURL),
    loopbackPort,
    buildArtifactDigest: state.export.buildArtifactDigest,
    runtimeDependencyClosureDigest: state.export.runtimeDependencyClosureDigest,
  };
  return {
    entry,
    workingDirectory: producerAPI.packageRoot,
    logPath,
    marker,
    apiBaseURL: credentials.apiBaseURL,
    ...authority,
    intentDigest: domainHash('nimi.realm-v3-full-data-api-resource/v3', authority),
  };
}

async function findAPIProcessByIntent(intent) {
  const output = process.platform === 'win32'
    ? await runCapture('ps', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "{0} {1}" -f $_.ProcessId,$_.CommandLine }',
    ])
    : await runCapture('ps', ['-axo', 'pid=,command=']);
  const markerArgument = `--realm-v3-full-data-environment=${intent.marker}`;
  const matches = output.stdout.split('\n').map((line) => line.trim()).filter((line) =>
    line.includes(intent.entry) && line.includes(markerArgument),
  );
  if (matches.length > 1) fail('api_recovery_ambiguous', 'multiple API processes match the durable intent');
  if (matches.length === 0) return null;
  const match = /^(\d+)\s+/u.exec(matches[0]);
  if (!match) fail('api_recovery_ambiguous', 'matching API process pid is invalid');
  return Number(match[1]);
}

function classifyPreparedAPIObservation({ recorded, launch, markerPID, recordedProcessExists, identityMatches }) {
  if (recordedProcessExists) {
    if (!recorded || markerPID !== recorded.pid || identityMatches !== true) return 'foreign';
    return 'healthy';
  }
  if (markerPID !== null) {
    if (
      !launch || launch.status !== 'starting' || launch.pid !== null ||
      launch.processIdentityDigest !== null ||
      !Number.isSafeInteger(launch.generation) || launch.generation < 1
    ) return 'foreign';
    return 'adopt';
  }
  return 'restart';
}

function assertPreparedAPIStateBinding(state, intent) {
  const api = state.api;
  const launch = state.resources?.apiLaunch;
  if (
    !api || !launch || !Number.isSafeInteger(api.pid) || api.pid <= 1 ||
    !Number.isSafeInteger(api.generation) || api.generation < 1 ||
    api.processIntentDigest !== intent.intentDigest || api.entrySha256 !== intent.entrySha256 ||
    api.runtimeDependencyClosureDigest !== intent.runtimeDependencyClosureDigest ||
    !SHA256_RE.test(api.processIdentity?.digest || '') ||
    launch.status !== 'running' || launch.generation !== api.generation ||
    launch.processIntentDigest !== intent.intentDigest || launch.pid !== api.pid ||
    launch.processIdentityDigest !== api.processIdentity.digest
  ) fail('resume_identity_mismatch', 'prepared API generation/process identity state is incomplete');
}

async function startAPI(state, credentials, intent, statePath) {
  await assertRuntimeDependencyClosure(state.export);
  if (await hashFile(intent.entry) !== intent.entrySha256) {
    fail('runtime_dependency_drift', 'fixed Realm API entry changed before startup');
  }
  const recordedProcessExists = Boolean(state.api?.pid && await processExists(state.api.pid));
  let recordedIdentity = null;
  if (recordedProcessExists) recordedIdentity = await captureProcessIdentity(state.api.pid);
  const recoveredPID = await findAPIProcessByIntent(intent);
  const classification = classifyPreparedAPIObservation({
    recorded: state.api,
    launch: state.resources.apiLaunch,
    markerPID: recoveredPID,
    recordedProcessExists,
    identityMatches: Boolean(
      recordedIdentity && state.api?.processIdentity?.digest === recordedIdentity.digest,
    ),
  });
  if (classification === 'foreign') {
    fail('resume_identity_mismatch', 'API marker/PID does not match its durable launch generation');
  }
  if (classification === 'healthy' || classification === 'adopt') {
    const pid = classification === 'healthy' ? state.api.pid : recoveredPID;
    const generation = classification === 'healthy'
      ? state.api.generation
      : state.resources.apiLaunch.generation;
    if (
      !Number.isSafeInteger(generation) || generation < 1 ||
      state.resources.apiLaunch?.processIntentDigest !== intent.intentDigest ||
      (classification === 'healthy' && (
        state.api?.processIntentDigest !== intent.intentDigest ||
        state.resources.apiLaunch?.status !== 'running' ||
        state.resources.apiLaunch?.pid !== state.api.pid ||
        state.resources.apiLaunch?.generation !== state.api.generation ||
        state.resources.apiLaunch?.processIdentityDigest !== state.api.processIdentity.digest
      ))
    ) {
      fail('resume_identity_mismatch', 'API generation is not bound to the stable process intent');
    }
    await waitForHTTP(`${credentials.apiBaseURL}/api/auth/jwks/source-materialization`, 180_000);
    const processIdentity = recordedIdentity ?? await captureProcessIdentity(pid);
    const observed = {
      pid,
      generation,
      logPath: intent.logPath,
      processIdentity,
      processIntentDigest: intent.intentDigest,
      entrySha256: intent.entrySha256,
      runtimeDependencyClosureDigest: intent.runtimeDependencyClosureDigest,
      proof: {
        processIntentDigest: intent.intentDigest,
        entryPathHash: intent.entryPathHash,
        workingDirectoryHash: intent.workingDirectoryHash,
        entrySha256: intent.entrySha256,
        logPathHash: intent.logPathHash,
        markerHash: intent.markerHash,
      },
    };
    state.api = observed;
    state.resources.apiLaunch = {
      generation,
      processIntentDigest: intent.intentDigest,
      status: 'running',
      pid,
      processIdentityDigest: processIdentity.digest,
    };
    await writePrivateJSON(statePath, state);
    return observed;
  }
  const generation = Math.max(
    Number.isSafeInteger(state.api?.generation) ? state.api.generation : 0,
    Number.isSafeInteger(state.resources.apiLaunch?.generation)
      ? state.resources.apiLaunch.generation
      : 0,
  ) + 1;
  state.resources.apiLaunch = {
    generation,
    processIntentDigest: intent.intentDigest,
    status: 'starting',
    pid: null,
    processIdentityDigest: null,
  };
  await writePrivateJSON(statePath, state);
  const entry = intent.entry;
  const logPath = intent.logPath;
  const logFD = openSync(logPath, 'a', 0o600);
  let child;
  try {
    child = spawn(
      process.execPath,
      [entry, `--realm-v3-full-data-environment=${intent.marker}`],
      {
        cwd: intent.workingDirectory,
        env: closedProcessEnvironment(credentials.custody.apiEnvironment, { allowDatabase: true }),
        detached: true,
        stdio: ['ignore', logFD, logFD],
      },
    );
  } finally {
    closeSync(logFD);
  }
  if (!child.pid) fail('api_start_failed', 'fixed Realm API pid is missing');
  child.unref();
  await waitForHTTP(`${credentials.apiBaseURL}/api/auth/jwks/source-materialization`, 180_000);
  if (!(await processExists(child.pid))) {
    fail('api_start_failed', 'fixed Realm API process exited during health verification');
  }
  const processIdentity = await captureProcessIdentity(child.pid);
  if (!processIdentity.raw.includes(intent.entry) || !processIdentity.raw.includes(intent.marker)) {
    fail('api_start_failed', 'started API process identity does not contain its stable intent marker');
  }
  const observed = {
    pid: child.pid,
    generation,
    logPath,
    processIdentity,
    processIntentDigest: intent.intentDigest,
    entrySha256: intent.entrySha256,
    runtimeDependencyClosureDigest: intent.runtimeDependencyClosureDigest,
    proof: {
      processIntentDigest: intent.intentDigest,
      entryPathHash: intent.entryPathHash,
      workingDirectoryHash: intent.workingDirectoryHash,
      entrySha256: intent.entrySha256,
      logPathHash: intent.logPathHash,
      markerHash: intent.markerHash,
    },
  };
  state.api = observed;
  state.resources.apiLaunch = {
    generation,
    processIntentDigest: intent.intentDigest,
    status: 'running',
    pid: child.pid,
    processIdentityDigest: processIdentity.digest,
  };
  await writePrivateJSON(statePath, state);
  return observed;
}

async function waitForHTTP(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let reason = 'not attempted';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
      if (response.status === 200) return;
      reason = `status ${response.status}`;
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  fail('api_start_failed', `fixed Realm API health timeout: ${reason}`);
}

async function captureProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) fail('unsafe_process_target', 'API pid is unsafe');
  const output = await runCapture('ps', ['-p', String(pid), '-o', 'pid=,ppid=,lstart=,command=']);
  const value = output.stdout.trim();
  if (!value) fail('process_missing', 'API process is absent');
  return { raw: value, digest: domainHash('nimi.realm-v3-full-data-api-process/v1', value) };
}

function base64URL(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function establishFormalOAuthSession(apiBaseURL, bootstrapAccessToken) {
  const verifier = base64URL(randomBytes(48));
  const challenge = base64URL(createHash('sha256').update(verifier).digest());
  const state = base64URL(randomBytes(24));
  const redirectURI = 'http://127.0.0.1:46373/oauth/callback';
  const authorize = new URL(`${apiBaseURL}/api/auth/oauth/authorize`);
  for (const [name, value] of Object.entries({
    response_type: 'code',
    client_id: 'nimi-desktop',
    redirect_uri: redirectURI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })) authorize.searchParams.set(name, value);
  const authorization = await fetch(authorize, {
    headers: { Cookie: `nimi_access_token=${bootstrapAccessToken}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  if (authorization.status !== 302) fail('oauth_session_failed', `OAuth authorize status ${authorization.status}`);
  const location = authorization.headers.get('location');
  if (!location) fail('oauth_session_failed', 'OAuth authorize omitted callback location');
  const callback = new URL(location);
  if (callback.origin + callback.pathname !== redirectURI || callback.searchParams.get('state') !== state) {
    fail('oauth_session_failed', 'OAuth callback binding mismatch');
  }
  const code = callback.searchParams.get('code');
  if (!code) fail('oauth_session_failed', 'OAuth callback omitted authorization code');
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: 'nimi-desktop',
    redirect_uri: redirectURI,
    code_verifier: verifier,
    code,
  });
  const response = await fetch(`${apiBaseURL}/api/auth/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 200) fail('oauth_session_failed', `OAuth token status ${response.status}`);
  const payload = await response.json();
  if (
    payload.account_id !== MATERIALIZER_ACCOUNT_ID ||
    typeof payload.access_token !== 'string' || payload.access_token.length < 32 ||
    typeof payload.refresh_token !== 'string' || payload.refresh_token.length < 32 ||
    !Number.isSafeInteger(payload.expires_in) || payload.expires_in <= 0
  ) {
    fail('oauth_session_failed', 'OAuth token response is invalid');
  }
  return {
    accountID: payload.account_id,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    accessExpiresAt: new Date(Date.now() + payload.expires_in * 1_000).toISOString(),
    tokenType: payload.token_type,
    realmEnvironmentID: payload.realm_environment_id,
  };
}

async function createFormalPersona(state, credentials, disposableDatabaseURL) {
  const inputPath = path.join(state.stateDirectory, 'persona.input.json');
  const outputPath = path.join(state.stateDirectory, 'persona.provisioning.json');
  const rawOutputPath = `${outputPath}.fixture-raw`;
  await writePrivateJSON(inputPath, {
    databaseURL: disposableDatabaseURL,
    apiBaseURL: credentials.apiBaseURL,
    accessToken: credentials.custody.oauth.accessToken,
    expectedInheritedPersona: state.n6Baseline.personaSourceRef,
  });
  await rm(rawOutputPath, { force: true });
  await runCapture(
    process.execPath,
    ['--import', 'tsx', credentials.helperPath, 'persona', inputPath, rawOutputPath],
    { cwd: state.export.exportRoot, env: closedProcessEnvironment() },
  );
  await rm(inputPath, { force: true });
  await assertPrivateRegularFile(rawOutputPath, 'raw Persona provisioning result');
  const persona = await readJSON(rawOutputPath, 'Persona provisioning result');
  await rm(rawOutputPath, { force: true });
  if (persona.kind !== 'personaCharacter' || persona.ownerAccountId !== MATERIALIZER_ACCOUNT_ID) {
    fail('persona_provisioning_failed', 'current Realm Persona fixture result is invalid');
  }
  await writePrivateJSON(outputPath, persona);
  return { outputPath, persona };
}

async function verifyFixedProducer(rootRealm) {
  const [commit, tree] = await Promise.all([
    runCapture('git', ['-C', rootRealm, 'rev-parse', `${FIXED_REALM_COMMIT}^{commit}`]),
    runCapture('git', ['-C', rootRealm, 'rev-parse', `${FIXED_REALM_COMMIT}^{tree}`]),
  ]);
  if (commit.stdout.trim() !== FIXED_REALM_COMMIT || tree.stdout.trim() !== FIXED_REALM_TREE) {
    fail('producer_mismatch', 'admitted current Realm commit/tree is unavailable');
  }
}

async function readProducerDigests(rootRealm) {
  const producerAdmission = await readJSON(
    path.join(MODULE_NIMI_ROOT, 'config', 'realm-v3', 'current-producer-admission.json'),
    'current producer admission',
  );
  const openapiFileName = producerAdmission?.openapi?.fileName;
  if (
    typeof openapiFileName !== 'string' || openapiFileName.length === 0 ||
    path.posix.basename(openapiFileName) !== openapiFileName
  ) {
    fail('producer_mismatch', 'current Realm admission has no safe OpenAPI artifact file name');
  }
  const inventory = await runCapture('git', [
    '-C',
    rootRealm,
    'ls-tree',
    '-r',
    '--name-only',
    FIXED_REALM_COMMIT,
  ]);
  const openapiCandidates = inventory.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && path.posix.basename(entry) === openapiFileName);
  if (openapiCandidates.length !== 1) {
    fail('producer_mismatch', 'current Realm OpenAPI artifact is missing or ambiguous');
  }
  const result = await runCapture('git', [
    '-C',
    rootRealm,
    'show',
    `${FIXED_REALM_COMMIT}:${openapiCandidates[0]}`,
  ]);
  const openapiDigest = sha256Hex(result.stdout);
  if (openapiDigest !== CURRENT_OPENAPI_DIGEST) {
    fail('producer_mismatch', 'current Realm OpenAPI digest differs from the admitted authority');
  }
  return {
    commit: FIXED_REALM_COMMIT,
    tree: FIXED_REALM_TREE,
    openapiDigest,
    policyDigest: CURRENT_ACCESS_POLICY_DIGEST,
  };
}

function targetBinding(options) {
  return {
    rootRealmPathHash: sha256Hex(options.rootRealm),
    nimiRootPathHash: sha256Hex(options.nimiRoot),
    dependencyRootPathHash: sha256Hex(options.dependencyRoot),
    stateDirectoryPathHash: sha256Hex(options.stateDirectory),
    attestationOutputPathHash: sha256Hex(options.attestationOutput),
    childRegistrationPathHash: sha256Hex(options.childRegistrationPath),
    wrapperIdentityDigest: options.wrapperTrust.sanitized.wrapperIdentityDigest,
    persistentPostgresContainer: options.persistentPostgresContainer,
    postgresUser: options.postgresUser,
    persistentDatabase: PERSISTENT_DATABASE,
    redisImage: options.redisImage,
    apiPort: options.apiPort ?? null,
  };
}

function declaredPersonaProvisioningIntent(state) {
  const intent = {
    method: 'current_realm_admitted_fullchain_fixture',
    fixtureSourcePath: FIXTURE_SOURCE_PATH,
    personaID: 'persona-character-0716-fullchain-fixture',
    ownerAccountIDHash: sha256Hex(MATERIALIZER_ACCOUNT_ID),
    disposableDatabaseNameHash: sha256Hex(state.disposableDatabase),
  };
  intent.intentDigest = domainHash('nimi.realm-v3-full-data-persona-provisioning-intent/v1', intent);
  return intent;
}

function assertRecoveredFixedPersona(persona, expected = null) {
  if (
    !persona || persona.kind !== 'personaCharacter' ||
    persona.id !== 'persona-character-0716-fullchain-fixture' ||
    persona.ownerAccountId !== MATERIALIZER_ACCOUNT_ID ||
    typeof persona.worldId !== 'string' || persona.worldId.length === 0 ||
    !SHA256_RE.test(persona.sourceHash || '')
  ) {
    fail('persona_provisioning_failed', 'interrupted current Realm Persona fixture cannot be recovered');
  }
  if (expected && canonicalJSONStringify(persona) !== canonicalJSONStringify(expected)) {
    fail('persona_provisioning_failed', 'interrupted Persona differs from the frozen N6 identity');
  }
  return persona;
}

function classifyInterruptedPersonaRecovery(personas, expected = null) {
  if (!Array.isArray(personas)) {
    fail('persona_provisioning_failed', 'interrupted Persona snapshot is invalid');
  }
  if (personas.length === 0) return 'rerun';
  if (personas.length === 1) {
    assertRecoveredFixedPersona(personas[0], expected);
    return 'replace';
  }
  fail('persona_provisioning_failed', 'interrupted Persona snapshot has conflicting rows');
}

async function normalizePrepareOptions(options) {
  const rootRealm = await realpath(options.rootRealm);
  const nimiRoot = await realpath(path.join(rootRealm, 'nimi'));
  const executingNimiRoot = await realpath(MODULE_NIMI_ROOT);
  const executingRootRealm = await realpath(path.dirname(executingNimiRoot));
  if (rootRealm !== executingRootRealm || nimiRoot !== executingNimiRoot) {
    fail('invalid_input', 'prepare Root/Nimi targets differ from the executing Nimi repository');
  }
  const dependencyRoot = await realpath(options.dependencyRoot);
  const stateDirectory = await assertSafeStateDirectoryTarget(options.stateDirectory, [rootRealm, path.join(rootRealm, 'nimi')]);
  if (!path.isAbsolute(options.attestationOutput)) fail('invalid_output', 'attestation output must be absolute');
  if (isInside(stateDirectory, path.resolve(options.attestationOutput)) || path.resolve(options.attestationOutput) === stateDirectory) {
    fail('invalid_output', 'attestation output must remain outside state-dir');
  }
  assertSafeName(options.persistentPostgresContainer, 'persistent PostgreSQL container');
  assertSafeName(options.postgresUser, 'PostgreSQL user');
  if (options.persistentDatabase !== PERSISTENT_DATABASE) fail('unsafe_database_target', 'persistent database must be exactly nimi_dev');
  if (options.apiPort !== null && options.apiPort !== undefined && (!Number.isSafeInteger(options.apiPort) || options.apiPort < 1 || options.apiPort > 65535)) {
    fail('invalid_api_port', 'API port is invalid');
  }
  if (!path.isAbsolute(options.childRegistrationPath || '')) {
    fail('child_registration_invalid', 'child-registration path must be absolute');
  }
  const wrapperTrust = await captureWrapperTrust(nimiRoot, options.childRegistrationPath);
  return {
    ...options,
    rootRealm,
    nimiRoot,
    dependencyRoot,
    stateDirectory,
    childRegistrationPath: wrapperTrust.registrationPath,
    wrapperTrust,
    attestationOutput: await assertAdmittedEvidenceOutput(
      rootRealm,
      options.attestationOutput,
      'live-environment-attestation.json',
    ),
  };
}

async function reconcilePreparedEnvironment(state, options, statePath) {
  await assertPrivateRegularFile(options.attestationOutput, 'bound live attestation');
  const attestation = validateLiveEnvironmentAttestation(
    await readJSON(options.attestationOutput, 'live attestation'),
  );
  if (
    attestation.contentHash !== state.attestationDigest ||
    state.attestationPath !== options.attestationOutput
  ) fail('resume_identity_mismatch', 'prepared attestation identity changed');
  if (
    canonicalJSONStringify(attestation.wrapper) !==
    canonicalJSONStringify(options.wrapperTrust.sanitized)
  ) fail('wrapper_identity_drift', 'prepared wrapper identity differs from current trusted closure');

  const n6Baseline = await readFrozenN6Baseline(options.nimiRoot);
  if (
    canonicalJSONStringify(n6Baseline) !== canonicalJSONStringify(state.n6Baseline) ||
    attestation.persistent.n6FrozenEvidenceSha256 !== n6Baseline.sha256 ||
    attestation.persistent.personaSourceRefHash !== n6Baseline.personaSourceRefHash
  ) fail('n6_baseline_mismatch', 'prepared environment frozen N6 baseline changed');

  const persistent = await readDatabaseSnapshot(
    options.persistentPostgresContainer,
    options.postgresUser,
    PERSISTENT_DATABASE,
    1,
  );
  assertPersistentMatchesFrozenN6(persistent, n6Baseline);
  if (
    persistent.snapshotDigest !== state.persistent.snapshotDigest ||
    persistent.instanceDigest !== state.persistent.instanceDigest ||
    persistent.snapshotDigest !== attestation.persistent.snapshotDigest
  ) fail('persistent_database_drift', 'persistent nimi_dev changed after preparation');

  const databaseIdentity = await databaseExists(
    options.persistentPostgresContainer,
    options.postgresUser,
    state.disposableDatabase,
  );
  if (
    databaseIdentity.exists !== true ||
    databaseIdentity.marker !== state.resources.databaseIntent?.marker
  ) fail('resume_identity_mismatch', 'prepared disposable database marker changed');
  const disposable = await readDatabaseSnapshot(
    options.persistentPostgresContainer,
    options.postgresUser,
    state.disposableDatabase,
    1,
  );
  if (
    canonicalJSONStringify(disposable.worlds) !== canonicalJSONStringify(persistent.worlds) ||
    disposable.worldSourceSetDigest !== persistent.worldSourceSetDigest ||
    canonicalJSONStringify(disposable.personas[0]) !==
      canonicalJSONStringify(n6Baseline.personaSourceRef) ||
    disposable.snapshotDigest !== attestation.disposable.snapshotDigest ||
    disposable.instanceDigest !== state.disposableInstanceDigest
  ) fail('resume_identity_mismatch', 'prepared disposable 470/1 source snapshot changed');

  const boundary = await captureWriteBoundary(options.rootRealm);
  if (
    canonicalJSONStringify(boundaryDigests(boundary)) !==
    canonicalJSONStringify(boundaryDigests(state.writeBoundary))
  ) fail('write_boundary_drift', 'Root/Nimi/nimi-apps changed after preparation');

  const currentDependency = await dependencyRootDigest(options.dependencyRoot);
  if (
    currentDependency.digest !== state.export.dependencyRootDigest ||
    currentDependency.storeDirectoryPathHash !== state.export.offlineStoreDirectoryPathHash ||
    await hashFile(state.export.archivePath) !== state.export.archiveSha256 ||
    await hashFile(path.join(state.export.exportRoot, FIXTURE_SOURCE_PATH)) !==
      state.export.fixtureSourceSha256
  ) fail('runtime_dependency_drift', 'prepared fixed Realm export/dependency input changed');
  await assertPrivateRegularFile(
    state.export.runtimeDependencyClosureManifestPath,
    'prepared runtime dependency closure manifest',
  );
  const frozenRuntimeManifest = await readJSON(
    state.export.runtimeDependencyClosureManifestPath,
    'prepared runtime dependency closure manifest',
  );
  if (
    domainHash(frozenRuntimeManifest.schemaVersion, frozenRuntimeManifest) !==
    state.export.runtimeDependencyClosureDigest
  ) fail('runtime_dependency_drift', 'prepared runtime dependency closure manifest changed');
  await assertRuntimeDependencyClosure(state.export);
  await assertPrivateRegularFile(state.credentials?.custodyPath, 'prepared credential custody');
  const custody = await readJSON(state.credentials.custodyPath, 'prepared credential custody');
  const credentialsIntent = await buildCredentialsIntent(state, options);
  if (
    canonicalJSONStringify(credentialsIntent) !==
      canonicalJSONStringify(state.resources.credentialsIntent) ||
    canonicalJSONStringify(state.credentials) !==
      canonicalJSONStringify(state.resources.credentialsIntent)
  ) fail('resume_identity_mismatch', 'prepared credential custody intent changed');
  const databaseURL = new URL(custody.apiEnvironment?.DATABASE_URL || 'invalid:');
  if (
    custody.accountID !== MATERIALIZER_ACCOUNT_ID || custody.oauth?.accountID !== MATERIALIZER_ACCOUNT_ID ||
    custody.apiEnvironment?.JWT_ISSUER !== state.credentials.apiBaseURL ||
    Number(custody.apiEnvironment?.PORT) !== state.credentials.apiPort ||
    custody.apiEnvironment?.TEST_DATABASE_URL !== custody.apiEnvironment?.DATABASE_URL ||
    !['127.0.0.1', 'localhost'].includes(databaseURL.hostname) ||
    decodeURIComponent(databaseURL.pathname.replace(/^\//u, '')) !== state.disposableDatabase ||
    custody.apiEnvironment?.REDIS_URL !== `redis://127.0.0.1:${state.redis.port}`
  ) fail('resume_identity_mismatch', 'prepared credential custody authority changed');

  await reconcilePreparedRedis(state, statePath);
  const credentials = { ...state.credentials, custody };
  const apiIntent = await buildAPIIntent(state, credentials);
  if (canonicalJSONStringify(apiIntent) !== canonicalJSONStringify(state.resources.apiIntent)) {
    fail('resume_identity_mismatch', 'prepared API stable process intent changed');
  }
  assertPreparedAPIStateBinding(state, apiIntent);
  state.api = await startAPI(state, credentials, state.resources.apiIntent, statePath);
  if (
    attestation.api.processIntentDigest !== apiIntent.intentDigest ||
    attestation.api.entrySha256 !== apiIntent.entrySha256 ||
    attestation.api.runtimeDependencyClosureDigest !== state.export.runtimeDependencyClosureDigest
  ) fail('resume_identity_mismatch', 'prepared API attestation differs from its stable process intent');
  state.phase = 'prepared';
  await writePrivateJSON(statePath, state);
  return { state, attestation, resumed: true };
}


export {
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
};

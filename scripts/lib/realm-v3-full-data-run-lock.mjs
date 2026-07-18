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
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import YAML from 'yaml';
import {
  validateLiveEnvironmentAttestationBinding,
  validateLiveEnvironmentCleanupReceipt,
  validateLiveEnvironmentExecutionReceipt,
} from './realm-v3-full-data-live-environment.mjs';

import {
  ACCESS_POLICY_VERSION,
  AGGREGATE_SCHEMA,
  AUTHORIZATION_BOUNDARY,
  AUTHORIZATION_INPUTS,
  CAPTURE_INDEX_SCHEMA,
  CLOSE_CANDIDATE_SCHEMA,
  CONTRACT_EXACT_PATHS,
  CONTRACT_PATH_PATTERNS,
  FIRST_PARTY_AUTHORITY_CLASS,
  FIXED_PERSONA_SOURCE,
  FORBIDDEN_AUTHORIZATION_INPUTS,
  FullDataContractError,
  FULL_DATA_DENOMINATOR,
  FULL_DATA_STAGES,
  GIT_OBJECT_RE,
  MANIFEST_SCHEMA,
  PACKET_OPERATION,
  PACKET_SCHEMA,
  PARTITION_STAGES,
  PERSONA_CHARACTER_DENOMINATOR,
  PROGRESS_INTERVAL_MS,
  REASON_RE,
  RECEIPT_SCHEMA,
  RETIRED_AUTHORIZATION_ENDPOINTS,
  RETIRED_AUTHORIZATION_IDENTIFIERS,
  RUN_LOCK_SCHEMA,
  SAFE_ID_RE,
  SHA256_RE,
  SNAPSHOT_SCHEMA,
  SOURCE_CENSUS_SCHEMA,
  SOURCE_LANES,
  STAGE_REPORT_SCHEMA,
  WORLD_CHARACTER_DENOMINATOR,
  assertClosedObject,
  assertCount,
  assertEqual,
  assertExactKeys,
  assertGitObject,
  assertNoAmbientNodeInjection,
  assertSHA256,
  assertString,
  canonicalJSONStringify,
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
  readJSON,
  requireOwnedRuntimeDataRoot,
  sha256File,
  sha256Hex,
  syncDirectory,
  validateEvidenceDirectory,
  validateRuntimeDataRoot,
  writeJSONAtomic,
} from './realm-v3-full-data-contract.mjs';

import {
  assertFixedPersonaSource,
  buildCensusExpectation,
  buildWorkerIdentity,
  buildWorkerInputIdentity,
  contractPathInventory,
  currentGitIdentity,
  findCaptureIndex,
  liveExecutionReceiptBindingDigest,
  liveExecutionStableAuthority,
  liveSourceInputFromEvidence,
  loadLiveExecutionReceipt,
  materializeLiveWorkerArguments,
  parseLock,
  parseSourceRef,
  resolveWorkerExecutable,
  validateFrozenLiveSourceInput,
  validateLiveEnvironmentProjection,
  validateLiveWorkerArgumentTemplate,
  validateSourceCensus,
} from './realm-v3-full-data-preflight.mjs';

const HAS_POSIX_PERMISSION_BITS = process.platform !== 'win32' && typeof process.getuid === 'function';
async function loadNC6Evidence(nimiRoot, evidencePath, lock) {
  if (!evidencePath || !path.isAbsolute(evidencePath)) {
    fail('missing_nc6_evidence', 'final full-data acceptance requires an absolute NC6 evidence artifact');
  }
  const resolvedRoot = realpathSync(path.resolve(nimiRoot));
  const resolvedPath = path.resolve(evidencePath);
  const admittedRoot = path.join(resolvedRoot, '.nimi', 'local');
  const canonicalPath = canonicalPathThroughExistingAncestor(resolvedPath, 'NC6 evidence');
  if (
    canonicalPath !== resolvedPath ||
    !canonicalPath.startsWith(`${admittedRoot}${path.sep}`)
  ) {
    fail('unsafe_nc6_evidence_path', 'NC6 evidence must be below Nimi .nimi/local');
  }
  const info = await lstat(canonicalPath).catch((error) => {
    fail('missing_nc6_evidence', `NC6 evidence is unavailable: ${error.message}`);
  });
  if (!info.isFile() || info.isSymbolicLink()) {
    fail('unsafe_nc6_evidence_path', 'NC6 evidence must be a regular non-symlink file');
  }
  const raw = await readFile(canonicalPath);
  let evidence;
  try {
    evidence = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    fail('invalid_nc6_evidence', `NC6 evidence is invalid JSON: ${error.message}`);
  }
  const producer = evidence?.fixedProducer;
  const policy = producer?.realmAccessPolicy;
  const producerAdmissionPath = path.join(
    resolvedRoot,
    'config',
    'realm-v3',
    'current-producer-admission.json',
  );
  const producerAdmission = await readJSON(producerAdmissionPath, 'current producer admission');
  const producerAdmissionSha256 = await sha256File(producerAdmissionPath);
  if (
    evidence?.schemaVersion !== 'nimi.realm-v3-compact-acceptance/v1' ||
    evidence?.mode !== 'current-realm-live' ||
    evidence?.status !== 'PASS' ||
    evidence?.currentRealmLive !== 'PASS' ||
    producer?.commit !== lock.realm.commit ||
    producer?.tree !== lock.realm.tree ||
    producer?.packetSchema !== lock.schema_versions.packet ||
    producer?.accessPolicy !== lock.access_policy.version ||
    producer?.accessPolicyDigest !== lock.access_policy.digest ||
    producer?.admissionSchemaVersion !== 'nimi.realm-current-producer-admission/v3' ||
    producer?.admissionSha256 !== producerAdmissionSha256 ||
    producerAdmission?.schemaVersion !== producer.admissionSchemaVersion ||
    producerAdmission?.admittedCommit !== lock.realm.commit ||
    producerAdmission?.admittedTree !== lock.realm.tree ||
    producerAdmission?.headPolicy !== lock.producer_admission.head_policy ||
    producer?.validation !== 'PASS'
  ) {
    fail('invalid_nc6_evidence', 'NC6 evidence does not prove the frozen current Realm authority');
  }
  if (
    policy?.version !== ACCESS_POLICY_VERSION ||
    policy?.digest !== lock.access_policy.digest ||
    policy?.authorityClass !== FIRST_PARTY_AUTHORITY_CLASS ||
    policy?.thirdPartyAppPermissionRequired !== false ||
    policy?.permissionCatalog !== 'empty'
  ) {
    fail('invalid_nc6_evidence', 'NC6 evidence does not preserve the first-party no-permission authority');
  }
  assertEqual(policy.packetOperation, PACKET_OPERATION, 'invalid_nc6_evidence', 'NC6 Packet operation');
  assertEqual(policy.authorizationInputs, AUTHORIZATION_INPUTS, 'invalid_nc6_evidence', 'NC6 authorization inputs');
  assertEqual(policy.forbiddenInputs, FORBIDDEN_AUTHORIZATION_INPUTS, 'invalid_nc6_evidence', 'NC6 forbidden inputs');
  assertEqual(policy.retiredIdentifiers, RETIRED_AUTHORIZATION_IDENTIFIERS, 'invalid_nc6_evidence', 'NC6 retired identifiers');
  assertEqual(policy.retiredEndpoints, RETIRED_AUTHORIZATION_ENDPOINTS, 'invalid_nc6_evidence', 'NC6 retired endpoints');

  const passedTests = new Set(
    Array.isArray(evidence?.tests)
      ? evidence.tests.filter((entry) => entry?.status === 'PASS').map((entry) => entry?.id)
      : [],
  );
  for (const required of [
    'runtime-hermetic-fullchain-security',
    'account-current-jwks-first-party-materialization',
    'desktop-current-first-party-packet-v3-fixture',
    'current-realm-live-world-persona',
  ]) {
    if (!passedTests.has(required)) {
      fail('invalid_nc6_evidence', `NC6 evidence is missing passing test ${required}`);
    }
  }
  if (
    evidence?.writeBoundary?.status !== 'PASS' ||
    evidence?.writeBoundary?.rootRealmUnchanged !== true ||
    evidence?.writeBoundary?.nimiUnchanged !== true ||
    evidence?.writeBoundary?.nimiAppsUnchanged !== true ||
    evidence?.rawTransportResidue !== 0 ||
    evidence?.orphanSnapshots !== 0 ||
    evidence?.orphanProvenance !== 0 ||
    evidence?.protectedDiffs !== 0
  ) {
    fail('invalid_nc6_evidence', 'NC6 evidence is missing live write-boundary or zero-residue proof');
  }
  return {
    schemaVersion: evidence.schemaVersion,
    sha256: sha256Hex(raw),
    status: evidence.status,
    mode: evidence.mode,
    currentRealmLive: evidence.currentRealmLive,
    fixedProducerValidation: producer.validation,
  };
}

async function loadLiveEnvironmentAttestation(nimiRoot, attestationPath) {
  if (!attestationPath || !path.isAbsolute(attestationPath)) {
    fail('missing_live_environment', 'live full-data acceptance requires an absolute environment attestation');
  }
  const resolvedRoot = realpathSync(path.resolve(nimiRoot));
  const resolvedPath = path.resolve(attestationPath);
  const admittedRoot = path.join(
    resolvedRoot,
    '.nimi',
    'local',
    'acceptance',
    '0717-realm-v3-consumer-hardcut',
    'N7',
  );
  const canonicalPath = canonicalPathThroughExistingAncestor(resolvedPath, 'live environment attestation');
  if (
    canonicalPath !== resolvedPath ||
    !canonicalPath.startsWith(`${admittedRoot}${path.sep}`) ||
    path.basename(canonicalPath) !== 'live-environment-attestation.json'
  ) {
    fail('unsafe_live_environment_path', 'live environment attestation is outside the admitted N7 evidence root');
  }
  const info = await lstat(canonicalPath).catch((error) => {
    fail('missing_live_environment', `live environment attestation is unavailable: ${error.message}`);
  });
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (HAS_POSIX_PERMISSION_BITS && (info.mode & 0o077) !== 0) ||
    (HAS_POSIX_PERMISSION_BITS && info.uid !== process.getuid())
  ) {
    fail('unsafe_live_environment_path', 'live environment attestation must be a current-user private regular file');
  }
  const raw = await readFile(canonicalPath);
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    fail('invalid_live_environment', `live environment attestation is invalid JSON: ${error.message}`);
  }
  let binding;
  try {
    binding = validateLiveEnvironmentAttestationBinding(parsed);
  } catch (error) {
    fail('invalid_live_environment', `live environment attestation failed validation: ${error.message}`);
  }
  validateLiveEnvironmentProjection(binding.liveEnvironmentProjection);
  return {
    path: canonicalPath,
    fileSha256: sha256Hex(raw),
    wrapperIdentityDigest: binding.attestation.wrapper.wrapperIdentityDigest,
    censusChildIdentityDigest: binding.attestation.wrapper.allowedChildren.find(
      (entry) => entry.stage === 'census',
    )?.childIdentityDigest,
    partitionChildIdentityDigest: binding.attestation.wrapper.allowedChildren.find(
      (entry) => entry.stage === 'partition',
    )?.childIdentityDigest,
    ...binding,
  };
}

async function invokeCensusWorker({
  nimiRoot,
  evidenceDir,
  worker,
  workerArgs,
  workerChildExecutable = null,
  workerInputPaths = [],
  liveEnvironmentAttestationDigest,
  liveEnvironmentWrapperIdentityDigest,
  liveEnvironmentWrapperRegistrationDigest,
  liveEnvironmentCensusChildIdentityDigest,
  liveEnvironment,
  progressIntervalMs,
}) {
  if (!worker) fail('missing_census_worker', 'live source preflight requires an explicit census worker');
  const expectedIdentity = await buildCensusExpectation(nimiRoot);
  const workerIdentityBefore = await buildWorkerIdentity({
    nimiRoot,
    command: worker,
    args: workerArgs,
    childExecutablePath: workerChildExecutable,
    inputPaths: workerInputPaths,
    label: 'census worker',
    implementationSourceDigest: expectedIdentity.nimi.contractDigest,
  });
  const workDir = path.join(evidenceDir, '.work');
  await mkdir(workDir, { recursive: true, mode: 0o700 });
  const requestPath = path.join(workDir, 'source-census.request.json');
  const outputPath = path.join(workDir, 'source-census.receipt.json');
  const executionDirectory = path.join(workDir, 'census-execution');
  const executionReceiptPath = path.join(
    executionDirectory,
    'live-environment-execution-receipt.json',
  );
  await mkdir(executionDirectory, { recursive: true, mode: 0o700 });
  await rm(outputPath, { force: true });
  await rm(executionReceiptPath, { force: true });
  await writeJSONAtomic(requestPath, {
    schemaVersion: 'nimi.realm-v3-full-data-source-census-request/v1',
    producer: expectedIdentity.realm,
    nimi: expectedIdentity.nimi,
    denominator: {
      total: FULL_DATA_DENOMINATOR,
      worldCharacters: WORLD_CHARACTER_DENOMINATOR,
      personaCharacters: PERSONA_CHARACTER_DENOMINATOR,
    },
    persistentDatabase: 'nimi_dev',
    sourceDatabaseAccess: 'read_only_census',
    sourceOrder: 'kind_id_source_hash_lexicographic',
    secretFieldsInReceipt: 'forbidden',
  });
  const startedAt = Date.now();
  const executionPartition = 'live-source-census';
  const invocationArgs = materializeLiveWorkerArguments(
    workerArgs,
    executionPartition,
    executionReceiptPath,
  );
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(workerIdentityBefore.executablePath, invocationArgs, {
      cwd: path.resolve(nimiRoot),
      env: closedExecutionEnvironment({
        NIMI_REALM_V3_FULL_CENSUS_REQUEST_PATH: requestPath,
        NIMI_REALM_V3_FULL_CENSUS_RECEIPT_PATH: outputPath,
      }),
      stdio: ['ignore', 'ignore', 'ignore'],
      shell: false,
    });
    const heartbeat = setInterval(() => {
      emitProgress({
        stage: 'preflight',
        partition: 'live-source-census',
        completed: 0,
        failed: 0,
        startedAt,
        recent: 'read-only Realm source census worker remains active',
      });
    }, progressIntervalMs);
    child.once('error', (error) => {
      clearInterval(heartbeat);
      reject(error);
    });
    child.once('close', (code) => {
      clearInterval(heartbeat);
      resolve(code ?? 1);
    });
  }).catch(() => 1);
  if (exitCode !== 0) {
    await rm(requestPath, { force: true });
    await rm(outputPath, { force: true });
    fail('live_census_worker_failed', `live source census worker exited ${exitCode}`);
  }
  try {
    const executionReceipt = await loadLiveExecutionReceipt(executionReceiptPath, {
      status: 'PASS',
      reasonCode: 'passed',
      environmentAttestationDigest: liveEnvironmentAttestationDigest,
      wrapperIdentityDigest: liveEnvironmentWrapperIdentityDigest,
      childRegistrationDigest: liveEnvironmentWrapperRegistrationDigest,
      stage: 'census',
      partitionIdHash: sha256Hex(executionPartition),
      childIdentityDigest: liveEnvironmentCensusChildIdentityDigest,
      ...liveExecutionStableAuthority(liveEnvironment),
      exitCode: 0,
      signal: null,
      identityUnchanged: true,
    });
    const census = validateSourceCensus(
      await readJSON(outputPath, 'live source census receipt'),
      { ...expectedIdentity, liveEnvironmentAttestationDigest },
    );
    const workerIdentityAfter = await buildWorkerIdentity({
      nimiRoot,
      command: workerIdentityBefore.executablePath,
      args: workerArgs,
      childExecutablePath: workerChildExecutable,
      inputPaths: workerInputPaths,
      label: 'census worker',
      implementationSourceDigest: expectedIdentity.nimi.contractDigest,
    });
    assertEqual(workerIdentityAfter, workerIdentityBefore, 'worker_identity_mismatch', 'census worker identity');
    return { census, executionReceipt };
  } finally {
    await rm(requestPath, { force: true });
    await rm(outputPath, { force: true });
    await rm(executionDirectory, { recursive: true, force: true });
    await syncDirectory(workDir);
  }
}

export async function buildRunLock({
  nimiRoot,
  realmEvidence = null,
  runtimeDataRoot = null,
  mode = 'development',
  upstreamEvidencePath = null,
  sourceMode = mode === 'final' ? 'live' : 'captured',
  sourceCensus = null,
  censusExecutionReceipt = null,
  frozenSourceInput = null,
  liveEnvironment = null,
  liveEnvironmentAttestationDigest = null,
  liveEnvironmentAttestationFileSha256 = null,
  liveEnvironmentWrapperRegistrationDigest = null,
  liveEnvironmentWrapperIdentityDigest = null,
  liveEnvironmentCensusChildIdentityDigest = null,
  liveEnvironmentPartitionChildIdentityDigest = null,
  partitionWorker,
  partitionWorkerArgs = [],
  partitionWorkerChildExecutable = null,
  partitionWorkerInputPaths = [],
  censusWorker = null,
  censusWorkerArgs = [],
  censusWorkerChildExecutable = null,
  censusWorkerInputPaths = [],
}) {
  if (!['development', 'final'].includes(mode)) {
    fail('invalid_run_mode', `run mode ${mode} is not admitted`);
  }
  const resolvedNimiRoot = path.resolve(nimiRoot);
  const resolvedRealmEvidence = realmEvidence ? path.resolve(realmEvidence) : null;
  const lockPath = path.join(resolvedNimiRoot, 'config', 'realm-contract-lock.yaml');
  const lock = parseLock(YAML.parse(await readFile(lockPath, 'utf8')));
  const syncedOpenAPI = path.join(resolvedNimiRoot, lock.openapi.synced_path);
  const actualOpenAPIDigest = await sha256File(syncedOpenAPI);
  if (actualOpenAPIDigest !== lock.openapi.document_sha256) {
    fail('openapi_digest_mismatch', 'synced Realm OpenAPI does not match the current lock');
  }
  const contractPaths = await contractPathInventory(resolvedNimiRoot);
  const consumerContractDigest = domainHash(
    'nimi.realm-v3-full-data-consumer-contract/v1',
    contractPaths,
  );
  const gitIdentity = await currentGitIdentity(resolvedNimiRoot);
  const upstreamEvidence = mode === 'final'
    ? await loadNC6Evidence(resolvedNimiRoot, upstreamEvidencePath, lock)
    : null;
  if (!partitionWorker) {
    fail('missing_partition_worker', 'full-data run lock requires an explicit partition worker');
  }
  const partitionWorkerIdentity = await buildWorkerIdentity({
    nimiRoot: resolvedNimiRoot,
    command: partitionWorker,
    args: partitionWorkerArgs,
    childExecutablePath: partitionWorkerChildExecutable,
    inputPaths: partitionWorkerInputPaths,
    label: 'partition worker',
    implementationSourceDigest: consumerContractDigest,
  });
  const censusWorkerIdentity = sourceMode === 'live'
    ? await buildWorkerIdentity({
        nimiRoot: resolvedNimiRoot,
        command: censusWorker,
        args: censusWorkerArgs,
        childExecutablePath: censusWorkerChildExecutable,
        inputPaths: censusWorkerInputPaths,
        label: 'census worker',
        implementationSourceDigest: consumerContractDigest,
      })
    : null;
  if (!['live', 'captured'].includes(sourceMode)) {
    fail('invalid_source_mode', `source mode ${sourceMode} is not admitted`);
  }
  if (mode === 'final' && sourceMode !== 'live') {
    fail('captured_final_forbidden', 'final full-data acceptance must use a current live source census');
  }
  if (
    sourceMode === 'live' &&
    (
      !partitionWorkerChildExecutable ||
      !censusWorkerChildExecutable ||
      !liveEnvironment ||
      !liveEnvironmentAttestationDigest ||
      !liveEnvironmentAttestationFileSha256 ||
      !liveEnvironmentWrapperRegistrationDigest ||
      !liveEnvironmentWrapperIdentityDigest ||
      !liveEnvironmentCensusChildIdentityDigest ||
      !liveEnvironmentPartitionChildIdentityDigest
    )
  ) {
    fail('invalid_live_environment', 'live full-data runs require an attested environment and frozen child executables');
  }
  if (sourceMode === 'live') {
    validateLiveWorkerArgumentTemplate(partitionWorkerArgs, 'partition', 'partition worker');
    validateLiveWorkerArgumentTemplate(censusWorkerArgs, 'census', 'census worker');
    validateLiveEnvironmentProjection(liveEnvironment);
    assertSHA256(liveEnvironmentAttestationDigest, 'live environment attestation digest');
    assertSHA256(liveEnvironmentAttestationFileSha256, 'live environment attestation file digest');
    assertSHA256(liveEnvironmentWrapperRegistrationDigest, 'live environment wrapper registration digest');
    assertSHA256(liveEnvironmentWrapperIdentityDigest, 'live environment wrapper identity digest');
    assertSHA256(liveEnvironmentCensusChildIdentityDigest, 'live environment census child identity digest');
    assertSHA256(liveEnvironmentPartitionChildIdentityDigest, 'live environment partition child identity digest');
  } else if (
    liveEnvironment !== null ||
    liveEnvironmentAttestationDigest !== null ||
    liveEnvironmentAttestationFileSha256 !== null ||
    liveEnvironmentWrapperRegistrationDigest !== null ||
    liveEnvironmentWrapperIdentityDigest !== null ||
    liveEnvironmentCensusChildIdentityDigest !== null ||
    liveEnvironmentPartitionChildIdentityDigest !== null
  ) {
    fail('invalid_live_environment', 'captured development runs cannot carry a live environment');
  }
  let captureIndex = null;
  let captureIndexPath = null;
  let sourceInput;
  if (sourceMode === 'live') {
    if (!sourceCensus && !frozenSourceInput) {
      fail('missing_live_census', 'live full-data input requires a current Realm source census');
    }
    if (sourceCensus && frozenSourceInput) {
      fail('invalid_frozen_source_input', 'live input cannot mix a fresh census with frozen source input');
    }
    if (sourceCensus && !censusExecutionReceipt) {
      fail('missing_execution_receipt', 'fresh live census is missing wrapper execution evidence');
    }
    if (sourceCensus) {
      try {
        censusExecutionReceipt = validateLiveEnvironmentExecutionReceipt(censusExecutionReceipt, {
          status: 'PASS',
          reasonCode: 'passed',
          environmentAttestationDigest: liveEnvironmentAttestationDigest,
          wrapperIdentityDigest: liveEnvironmentWrapperIdentityDigest,
          childRegistrationDigest: liveEnvironmentWrapperRegistrationDigest,
          stage: 'census',
          partitionIdHash: sha256Hex('live-source-census'),
          childIdentityDigest: liveEnvironmentCensusChildIdentityDigest,
          ...liveExecutionStableAuthority(liveEnvironment),
          exitCode: 0,
          signal: null,
          identityUnchanged: true,
        });
      } catch (error) {
        fail('invalid_execution_receipt', `fresh census execution receipt failed validation: ${error.message}`);
      }
    }
    if (sourceCensus) validateSourceCensus(sourceCensus, {
      realm: {
        commit: lock.realm.commit,
        tree: lock.realm.tree,
        openapiDigest: lock.openapi.document_sha256,
        policyDigest: lock.access_policy.digest,
      },
      nimi: {
        commit: gitIdentity.commit,
        tree: gitIdentity.tree,
        contractDigest: consumerContractDigest,
        worktreeDigest: gitIdentity.worktreeDigest,
      },
      liveEnvironmentAttestationDigest,
    });
    sourceInput = sourceCensus ? liveSourceInputFromEvidence(
      sourceCensus,
      censusExecutionReceipt,
    ) : structuredClone(
      validateFrozenLiveSourceInput(frozenSourceInput, liveEnvironmentAttestationDigest),
    );
  } else {
    if (!realmEvidence) {
      fail('missing_capture_evidence', 'captured development mode requires Realm evidence');
    }
    captureIndexPath = await findCaptureIndex(resolvedRealmEvidence);
    captureIndex = await readJSON(captureIndexPath, 'Realm captured packet index');
    const captureIndexSha256 = await sha256File(captureIndexPath);
    sourceInput = {
      mode: 'historical_capture_development',
      schemaVersion: captureIndex.schemaVersion,
      indexSha256: captureIndexSha256,
      contentHash: captureIndex.contentHash,
      sourceCount: Array.isArray(captureIndex.rows) ? captureIndex.rows.length : -1,
    };
  }
  const runLock = {
    schemaVersion: RUN_LOCK_SCHEMA,
    evidenceClass: mode === 'final' ? 'final_candidate' : 'development_resume',
    denominator: {
      total: FULL_DATA_DENOMINATOR,
      worldCharacters: WORLD_CHARACTER_DENOMINATOR,
      personaCharacters: PERSONA_CHARACTER_DENOMINATOR,
    },
    realm: {
      commit: lock.realm.commit,
      tree: lock.realm.tree,
      packetSchema: lock.schema_versions.packet,
      openapiDigest: lock.openapi.document_sha256,
      openapiFragmentDigest: lock.openapi.fragment_sha256,
      operationInventoryDigest: lock.openapi.operation_inventory_sha256,
      accessPolicyVersion: lock.access_policy.version,
      accessPolicyDigest: lock.access_policy.digest,
      authorityClass: lock.access_policy.authority_class,
      thirdPartyAppPermissionRequired: lock.access_policy.third_party_app_permission_required,
      permissionCatalog: lock.access_policy.permission_catalog,
      packetOperation: lock.access_policy.packet_operation,
      authorizationInputs: lock.access_policy.authorization_inputs,
      forbiddenInputs: lock.access_policy.forbidden_inputs,
      compactVectorDigests: lock.compact_vectors,
      producerAdmission: {
        trackedOnly: lock.producer_admission.tracked_only,
        headPolicy: lock.producer_admission.head_policy,
        semanticFileBundleDigest: lock.producer_admission.semantic_file_bundle_sha256,
      },
    },
    sourceInput,
    nimi: {
      branch: gitIdentity.branch,
      commit: gitIdentity.commit,
      tree: gitIdentity.tree,
      worktreeClean: gitIdentity.clean,
      worktreeStatusDigest: gitIdentity.statusDigest,
      trackedDiffDigest: gitIdentity.trackedDiffDigest,
      untrackedCount: gitIdentity.untrackedCount,
      untrackedContentDigest: gitIdentity.untrackedContentDigest,
      worktreeDigest: gitIdentity.worktreeDigest,
      consumerContractDigest,
      consumerContractPaths: contractPaths,
    },
    authorizationBoundary: AUTHORIZATION_BOUNDARY,
    workers: {
      partition: partitionWorkerIdentity,
      census: censusWorkerIdentity,
    },
    liveEnvironment: sourceMode === 'live' ? liveEnvironment : null,
    liveEnvironmentAttestationDigest: sourceMode === 'live'
      ? liveEnvironmentAttestationDigest
      : null,
    liveEnvironmentAttestationFileSha256: sourceMode === 'live'
      ? liveEnvironmentAttestationFileSha256
      : null,
    liveEnvironmentWrapperRegistrationDigest: sourceMode === 'live'
      ? liveEnvironmentWrapperRegistrationDigest
      : null,
    liveEnvironmentWrapperIdentityDigest: sourceMode === 'live'
      ? liveEnvironmentWrapperIdentityDigest
      : null,
    liveEnvironmentCensusChildIdentityDigest: sourceMode === 'live'
      ? liveEnvironmentCensusChildIdentityDigest
      : null,
    liveEnvironmentPartitionChildIdentityDigest: sourceMode === 'live'
      ? liveEnvironmentPartitionChildIdentityDigest
      : null,
    runtimeDataRootDigest: runtimeDataRoot
      ? domainHash('nimi.realm-v3-full-data-runtime-root/v1', path.resolve(runtimeDataRoot))
      : null,
    upstreamEvidence,
  };
  runLock.inputDigest = domainHash('nimi.realm-v3-full-data-run-lock/v1', runLock);
  return { runLock, captureIndex, captureIndexPath, sourceCensus, censusExecutionReceipt };
}

function validateRunLockIntegrity(runLock) {
  if (runLock?.schemaVersion !== RUN_LOCK_SCHEMA) {
    fail('run_lock_schema_mismatch', 'frozen full-data run lock schema is invalid');
  }
  assertSHA256(runLock.inputDigest, 'run lock inputDigest');
  const digestInput = { ...runLock };
  delete digestInput.inputDigest;
  if (domainHash(RUN_LOCK_SCHEMA, digestInput) !== runLock.inputDigest) {
    fail('run_lock_digest_mismatch', 'frozen full-data run lock content does not match inputDigest');
  }
  if (
    runLock.realm?.accessPolicyVersion !== ACCESS_POLICY_VERSION ||
    runLock.realm?.authorityClass !== FIRST_PARTY_AUTHORITY_CLASS ||
    runLock.realm?.thirdPartyAppPermissionRequired !== false ||
    runLock.realm?.permissionCatalog !== 'empty'
  ) {
    fail('wrong_authorization_boundary', 'frozen run lock does not preserve current Realm first-party authority');
  }
  assertEqual(runLock.realm.packetOperation, PACKET_OPERATION, 'wrong_packet_operation', 'run lock Realm Packet operation');
  assertEqual(runLock.realm.authorizationInputs, AUTHORIZATION_INPUTS, 'wrong_authorization_inputs', 'run lock Realm authorization inputs');
  assertEqual(runLock.realm.forbiddenInputs, FORBIDDEN_AUTHORIZATION_INPUTS, 'wrong_forbidden_inputs', 'run lock Realm forbidden inputs');
  assertEqual(runLock.authorizationBoundary, AUTHORIZATION_BOUNDARY, 'wrong_authorization_boundary', 'run lock authorization boundary');
  if (
    runLock.realm?.producerAdmission?.trackedOnly !== true ||
    runLock.realm?.producerAdmission?.headPolicy !== 'identical_admitted_inputs'
  ) {
    fail('wrong_producer_admission', 'frozen run lock does not preserve tracked-only producer admission');
  }
  assertSHA256(
    runLock.realm.producerAdmission.semanticFileBundleDigest,
    'run lock realm.producerAdmission.semanticFileBundleDigest',
  );
  return runLock;
}

export {
  invokeCensusWorker,
  loadLiveEnvironmentAttestation,
  loadNC6Evidence,
  validateRunLockIntegrity,
};

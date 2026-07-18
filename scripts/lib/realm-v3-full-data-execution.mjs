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
  initializePreflightRuntimeDataRoot,
  initializeRuntimeDataRoot,
  loadOptionalPrivateEvidenceArtifact,
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
  materializeLiveWorkerArguments,
  parseLock,
  parseSourceRef,
  resolveWorkerExecutable,
  validateFrozenLiveSourceInput,
  validateLiveEnvironmentProjection,
  validateLiveWorkerArgumentTemplate,
  validateSourceCensus,
} from './realm-v3-full-data-preflight.mjs';
import {
  buildRunLock,
  invokeCensusWorker,
  loadLiveEnvironmentAttestation,
  loadNC6Evidence,
  validateRunLockIntegrity,
} from './realm-v3-full-data-run-lock.mjs';

import {
  buildPartitionManifest,
  inspectCaptureRow,
  validateAttemptGenerations,
  validateCaptureIndex,
  validateCapturedEvidence,
  validateLaneCounts,
  validateLaneHashes,
  validateLiveAuthorization,
  validateLiveEvidence,
  validateMaterializationEvidence,
  validatePartitionManifest,
  validatePartitionReceipt,
  validateRestartEvidence,
  validateTransportEvidence,
} from './realm-v3-full-data-manifest.mjs';
function receiptPath(evidenceDir, stage, partitionKey) {
  return path.join(evidenceDir, 'partitions', partitionKey, `${stage}.json`);
}

async function existingReceipt(evidenceDir, stage, partition, runLock) {
  const filePath = receiptPath(evidenceDir, stage, partition.partitionKey);
  try {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      fail('invalid_receipt_path', `${filePath} is not a regular non-symlink file`);
    }
  } catch (error) {
    if (error instanceof FullDataContractError) throw error;
    return null;
  }
  return validatePartitionReceipt(await readJSON(filePath, `partition ${partition.ordinal} receipt`), {
    stage,
    partition,
    runLock,
  });
}

export async function selectPartitionsForResume({ evidenceDir, stage, manifest, runLock }) {
  const pending = [];
  const reused = [];
  const priorFailures = [];
  for (const partition of manifest.partitions) {
    const receipt = await existingReceipt(evidenceDir, stage, partition, runLock);
    if (receipt?.status === 'PASS') reused.push(partition);
    else {
      pending.push(partition);
      if (receipt?.status === 'FAIL') priorFailures.push(partition);
    }
  }
  return { pending, reused, priorFailures };
}

function safeFailureReceipt({ stage, partition, runLock, reasonCode }) {
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA,
    stage,
    inputDigest: runLock.inputDigest,
    partitionKey: partition.partitionKey,
    ordinal: partition.ordinal,
    source: {
      kind: partition.source.kind,
      id: partition.source.id,
      sourceHash: partition.source.sourceHash,
      sourceRefHash: partition.source.sourceRefHash,
    },
    identity: partition.identity,
    status: 'FAIL',
    reasonCode,
    evidence: null,
  };
  receipt.contentHash = domainHash(RECEIPT_SCHEMA, receipt);
  return receipt;
}

function assembleLivePartitionReceipt(workerReceipt, executionReceipt, context) {
  const assembled = {
    ...workerReceipt,
    workerContentHash: workerReceipt.contentHash,
    executionReceipt,
  };
  delete assembled.contentHash;
  assembled.contentHash = domainHash(RECEIPT_SCHEMA, assembled);
  return validatePartitionReceipt(assembled, context);
}

function orderedReceiptSetDigest(stage, receipts) {
  return domainHash(
    'nimi.realm-v3-full-data-stage-receipt-set/v1',
    receipts.map((receipt) => ({
      stage,
      ordinal: receipt.ordinal,
      partitionKey: receipt.partitionKey,
      contentHash: receipt.contentHash,
    })),
  );
}

function workerRequest({ stage, partition, runLock, realmEvidence, runtimeDataRoot }) {
  const capture = partition.capture
    ? {
        packetPath: path.resolve(realmEvidence, partition.capture.packetFile),
        packetBytes: partition.capture.packetBytes,
        packetSha256: partition.capture.packetSha256,
        jwksPath: path.resolve(realmEvidence, partition.capture.jwksFile),
        jwksSha256: partition.capture.jwksSha256,
        historicalAccessPolicyDigest: partition.capture.historicalAccessPolicyDigest,
        packetIssuedAt: partition.capture.packetIssuedAt,
        expectation: partition.capture.expectation,
        expectedTransport: partition.capture.expectedTransport,
      }
    : null;
  return {
    schemaVersion: 'nimi.realm-v3-full-data-partition-request/v1',
    stage,
    inputDigest: runLock.inputDigest,
    partitionKey: partition.partitionKey,
    ordinal: partition.ordinal,
    source: partition.source,
    identity: partition.identity,
    authorizationBoundary: runLock.authorizationBoundary,
    liveEnvironment: runLock.liveEnvironment,
    capture,
    runtimeDataRoot,
  };
}

async function invokeWorker({
  worker,
  workerArgs,
  workerChildExecutable = null,
  workerInputPaths = [],
  stage,
  partition,
  runLock,
  evidenceDir,
  realmEvidence,
  runtimeDataRoot,
  onHeartbeat,
  progressIntervalMs,
}) {
  const workerIdentityBefore = await buildWorkerIdentity({
    nimiRoot: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'),
    command: worker,
    args: workerArgs,
    childExecutablePath: workerChildExecutable,
    inputPaths: workerInputPaths,
    label: 'partition worker',
    implementationSourceDigest: runLock.nimi.consumerContractDigest,
  });
  assertEqual(
    workerIdentityBefore,
    runLock.workers.partition,
    'worker_identity_mismatch',
    'partition worker identity',
  );
  const workDir = path.join(evidenceDir, '.work');
  await mkdir(workDir, { recursive: true, mode: 0o700 });
  const requestPath = path.join(workDir, `${partition.partitionKey}.${stage}.request.json`);
  const outputPath = path.join(workDir, `${partition.partitionKey}.${stage}.receipt.json`);
  const liveWrapper = runLock.sourceInput.mode === 'current_realm_live_census';
  const executionPartition = `${stage}:${partition.ordinal}:${partition.partitionKey}`;
  const executionDirectory = path.join(workDir, 'executions', stage, partition.partitionKey);
  const executionReceiptPath = path.join(
    executionDirectory,
    'live-environment-execution-receipt.json',
  );
  if (liveWrapper) {
    await rm(executionDirectory, { recursive: true, force: true });
    await mkdir(executionDirectory, { recursive: true, mode: 0o700 });
  }
  await rm(outputPath, { force: true });
  await writeJSONAtomic(
    requestPath,
    workerRequest({ stage, partition, runLock, realmEvidence, runtimeDataRoot }),
  );
  const invocationArgs = liveWrapper
    ? materializeLiveWorkerArguments(workerArgs, executionPartition, executionReceiptPath)
    : workerArgs;
  let stderr = '';
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(workerIdentityBefore.executablePath, invocationArgs, {
      cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'),
      env: closedExecutionEnvironment({
        NIMI_REALM_V3_FULL_PARTITION_REQUEST_PATH: requestPath,
        NIMI_REALM_V3_FULL_PARTITION_RECEIPT_PATH: outputPath,
      }),
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false,
    });
    const heartbeat = setInterval(onHeartbeat, progressIntervalMs);
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 16_384) stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      clearInterval(heartbeat);
      reject(error);
    });
    child.once('close', (code) => {
      clearInterval(heartbeat);
      resolve(code ?? 1);
    });
  }).catch(() => 1);
  const executionReceipt = liveWrapper
    ? await loadLiveExecutionReceipt(executionReceiptPath, {
        environmentAttestationDigest: runLock.liveEnvironmentAttestationDigest,
        wrapperIdentityDigest: runLock.liveEnvironmentWrapperIdentityDigest,
        childRegistrationDigest: runLock.liveEnvironmentWrapperRegistrationDigest,
        stage: 'partition',
        partitionIdHash: sha256Hex(executionPartition),
        childIdentityDigest: runLock.liveEnvironmentPartitionChildIdentityDigest,
        ...liveExecutionStableAuthority(runLock.liveEnvironment),
      })
    : null;
  if (
    liveWrapper &&
    ((exitCode === 0) !== (executionReceipt.status === 'PASS'))
  ) {
    fail(
      'worker_exit_mismatch',
      `partition ${partition.ordinal} wrapper exit does not match its sealed execution receipt`,
    );
  }
  let receipt = null;
  try {
    receipt = await readJSON(outputPath, `worker receipt for partition ${partition.ordinal}`);
    receipt = validatePartitionReceipt(receipt, { stage, partition, runLock, provisional: true });
  } catch (error) {
    if (error instanceof FullDataContractError && error.code === 'missing_evidence') {
      receipt = safeFailureReceipt({ stage, partition, runLock, reasonCode: 'worker_no_receipt' });
    } else {
      await rm(requestPath, { force: true });
      await rm(outputPath, { force: true });
      throw error;
    }
  }
  if (liveWrapper) {
    receipt = assembleLivePartitionReceipt(receipt, executionReceipt, { stage, partition, runLock });
  }
  await rm(requestPath, { force: true });
  await rm(outputPath, { force: true });
  if (liveWrapper) {
    await rm(executionDirectory, { recursive: true, force: true });
    await rm(path.join(workDir, 'executions'), { recursive: true, force: true });
  }
  await syncDirectory(workDir);
  const workerIdentityAfter = await buildWorkerIdentity({
    nimiRoot: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'),
    command: workerIdentityBefore.executablePath,
    args: workerArgs,
    childExecutablePath: workerChildExecutable,
    inputPaths: workerInputPaths,
    label: 'partition worker',
    implementationSourceDigest: runLock.nimi.consumerContractDigest,
  });
  assertEqual(
    workerIdentityAfter,
    workerIdentityBefore,
    'worker_identity_mismatch',
    'partition worker identity after execution',
  );
  if (exitCode !== 0 && !liveWrapper && receipt.status === 'PASS') {
    fail('worker_exit_mismatch', `partition ${partition.ordinal} worker exited ${exitCode} after claiming PASS`);
  }
  return receipt;
}

function formatElapsed(startedAt) {
  const elapsed = Math.max(0, Date.now() - startedAt);
  const seconds = Math.floor(elapsed / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function emitProgress({ stage, partition, completed, failed, startedAt, recent }) {
  process.stdout.write(
    [
      `当前阶段：${stage}`,
      `当前 partition：${partition}`,
      `完成/总数：${completed}/${FULL_DATA_DENOMINATOR}`,
      `运行时间：${formatElapsed(startedAt)}`,
      `最近进展：${recent}`,
      `失败数：${failed}`,
      '是否可续跑：是',
      '',
    ].join('\n'),
  );
}

async function assertFrozenRunInputs({
  lockOptions,
  frozenRunLock,
  evidenceDir,
  censusWorker,
  censusWorkerArgs,
  censusWorkerChildExecutable,
  censusWorkerInputPaths,
  useFrozenSourceInput = false,
  progressIntervalMs,
}) {
  const censusExecution = frozenRunLock.sourceInput.mode === 'current_realm_live_census' && !useFrozenSourceInput
    ? await invokeCensusWorker({
        nimiRoot: lockOptions.nimiRoot,
        evidenceDir,
        worker: censusWorker,
        workerArgs: censusWorkerArgs,
        workerChildExecutable: censusWorkerChildExecutable,
        workerInputPaths: censusWorkerInputPaths,
        liveEnvironmentAttestationDigest: lockOptions.liveEnvironmentAttestationDigest,
        liveEnvironmentWrapperIdentityDigest: lockOptions.liveEnvironmentWrapperIdentityDigest,
        liveEnvironmentWrapperRegistrationDigest: lockOptions.liveEnvironmentWrapperRegistrationDigest,
        liveEnvironmentCensusChildIdentityDigest: lockOptions.liveEnvironmentCensusChildIdentityDigest,
        liveEnvironment: lockOptions.liveEnvironment,
        progressIntervalMs,
      })
    : null;
  const current = await buildRunLock({
    ...lockOptions,
    sourceCensus: censusExecution?.census ?? null,
    censusExecutionReceipt: censusExecution?.executionReceipt ?? null,
    frozenSourceInput: useFrozenSourceInput ? frozenRunLock.sourceInput : null,
  });
  validateFrozenRunLock(current.runLock, frozenRunLock);
  return current;
}

function censusIdentityFromRunLock(runLock) {
  return {
    realm: {
      commit: runLock.realm.commit,
      tree: runLock.realm.tree,
      openapiDigest: runLock.realm.openapiDigest,
      policyDigest: runLock.realm.accessPolicyDigest,
    },
    nimi: {
      commit: runLock.nimi.commit,
      tree: runLock.nimi.tree,
      contractDigest: runLock.nimi.consumerContractDigest,
      worktreeDigest: runLock.nimi.worktreeDigest,
    },
    liveEnvironmentAttestationDigest: runLock.liveEnvironmentAttestationDigest,
  };
}

async function validatePersistedLiveCensusEvidence({
  evidenceDir,
  runLock,
  manifest,
  freshSourceCensus = null,
  freshExecutionReceipt = null,
}) {
  if (runLock.sourceInput.mode !== 'current_realm_live_census') return null;
  const census = await loadOptionalPrivateEvidenceArtifact(
    path.join(evidenceDir, 'source-census.json'),
    'persisted live source census',
  );
  const executionReceipt = await loadOptionalPrivateEvidenceArtifact(
    path.join(evidenceDir, 'census-execution-receipt.json'),
    'persisted census wrapper execution receipt',
  );
  if (!census || !executionReceipt) {
    fail('missing_live_census', 'live run is missing durable source census or wrapper execution evidence');
  }
  validateSourceCensus(census, censusIdentityFromRunLock(runLock));
  if (census.contentHash !== runLock.sourceInput.contentHash) {
    fail('source_census_mismatch', 'persisted source census differs from the frozen run input');
  }
  let validatedExecutionReceipt;
  try {
    validatedExecutionReceipt = validateLiveEnvironmentExecutionReceipt(executionReceipt, {
      status: 'PASS',
      reasonCode: 'passed',
      environmentAttestationDigest: runLock.liveEnvironmentAttestationDigest,
      wrapperIdentityDigest: runLock.liveEnvironmentWrapperIdentityDigest,
      childRegistrationDigest: runLock.liveEnvironmentWrapperRegistrationDigest,
      stage: 'census',
      partitionIdHash: sha256Hex('live-source-census'),
      childIdentityDigest: runLock.liveEnvironmentCensusChildIdentityDigest,
      ...liveExecutionStableAuthority(runLock.liveEnvironment),
      exitCode: 0,
      signal: null,
      identityUnchanged: true,
    });
  } catch (error) {
    fail('invalid_execution_receipt', `persisted census execution receipt failed validation: ${error.message}`);
  }
  if (liveExecutionReceiptBindingDigest(validatedExecutionReceipt) !== runLock.sourceInput.censusExecutionBindingDigest) {
    fail('source_census_mismatch', 'persisted census execution binding differs from the frozen run input');
  }
  assertEqual(
    liveSourceInputFromEvidence(census, validatedExecutionReceipt),
    runLock.sourceInput,
    'source_census_mismatch',
    'persisted source census projection',
  );
  if (freshSourceCensus) {
    assertEqual(freshSourceCensus, census, 'resume_digest_mismatch', 'fresh/persisted source census');
  }
  if (
    freshExecutionReceipt &&
    liveExecutionReceiptBindingDigest(freshExecutionReceipt) !==
      liveExecutionReceiptBindingDigest(validatedExecutionReceipt)
  ) {
    fail('resume_digest_mismatch', 'fresh/persisted census execution bindings differ');
  }
  if (manifest.sourceCensusContentHash !== census.contentHash) {
    fail('source_census_mismatch', 'partition manifest references a different source census');
  }
  for (const [index, row] of census.sources.entries()) {
    assertEqual(
      manifest.partitions[index]?.source?.sourceRef,
      row.sourceRef,
      'source_census_mismatch',
      `partition ${index} source census binding`,
    );
  }
  return { census, executionReceipt: validatedExecutionReceipt };
}

async function persistLiveCensusEvidence({
  evidenceDir,
  runLock,
  manifest,
  sourceCensus,
  executionReceipt,
}) {
  const censusPath = path.join(evidenceDir, 'source-census.json');
  const executionPath = path.join(evidenceDir, 'census-execution-receipt.json');
  const existingCensus = await loadOptionalPrivateEvidenceArtifact(
    censusPath,
    'persisted live source census',
  );
  if (existingCensus) {
    assertEqual(existingCensus, sourceCensus, 'resume_digest_mismatch', 'persisted live source census');
  } else {
    await writeJSONAtomic(censusPath, sourceCensus);
  }
  const existingExecution = await loadOptionalPrivateEvidenceArtifact(
    executionPath,
    'persisted census wrapper execution receipt',
  );
  if (existingExecution) {
    if (
      liveExecutionReceiptBindingDigest(existingExecution) !==
      liveExecutionReceiptBindingDigest(executionReceipt)
    ) {
      fail('resume_digest_mismatch', 'persisted census wrapper binding changed');
    }
  } else {
    await writeJSONAtomic(executionPath, executionReceipt);
  }
  return validatePersistedLiveCensusEvidence({
    evidenceDir,
    runLock,
    manifest,
    freshSourceCensus: sourceCensus,
    freshExecutionReceipt: executionReceipt,
  });
}

async function admitOrWriteExactPreflightArtifact(filePath, expected, label) {
  const existing = await loadOptionalPrivateEvidenceArtifact(filePath, label);
  if (existing) {
    assertEqual(existing, expected, 'resume_digest_mismatch', label);
    return existing;
  }
  await writeJSONAtomic(filePath, expected);
  const committed = await loadOptionalPrivateEvidenceArtifact(filePath, label);
  if (!committed) fail('missing_evidence', `${label} was not durably committed`);
  assertEqual(committed, expected, 'resume_digest_mismatch', label);
  return committed;
}

async function validateExistingPreflightArtifacts({
  lockFile,
  manifestFile,
  evidenceDir,
  runLock,
  manifest,
  sourceCensus,
  censusExecutionReceipt,
}) {
  const existingLock = await loadOptionalPrivateEvidenceArtifact(
    lockFile,
    'frozen full-data run lock',
  );
  if (existingLock) validateFrozenRunLock(runLock, existingLock);

  const existingManifest = await loadOptionalPrivateEvidenceArtifact(
    manifestFile,
    'full-data partition manifest',
  );
  if (existingManifest) {
    validatePartitionManifest(existingManifest, runLock);
    assertEqual(existingManifest, manifest, 'resume_digest_mismatch', 'full-data partition manifest');
  }

  if (runLock.sourceInput.mode !== 'current_realm_live_census') {
    return { existingLock, existingManifest };
  }
  const existingCensus = await loadOptionalPrivateEvidenceArtifact(
    path.join(evidenceDir, 'source-census.json'),
    'persisted live source census',
  );
  if (existingCensus) {
    validateSourceCensus(existingCensus, censusIdentityFromRunLock(runLock));
    assertEqual(existingCensus, sourceCensus, 'resume_digest_mismatch', 'persisted live source census');
  }
  const existingExecution = await loadOptionalPrivateEvidenceArtifact(
    path.join(evidenceDir, 'census-execution-receipt.json'),
    'persisted census wrapper execution receipt',
  );
  if (existingExecution) {
    let validatedExecution;
    try {
      validatedExecution = validateLiveEnvironmentExecutionReceipt(existingExecution, {
        status: 'PASS',
        reasonCode: 'passed',
        environmentAttestationDigest: runLock.liveEnvironmentAttestationDigest,
        wrapperIdentityDigest: runLock.liveEnvironmentWrapperIdentityDigest,
        childRegistrationDigest: runLock.liveEnvironmentWrapperRegistrationDigest,
        stage: 'census',
        partitionIdHash: sha256Hex('live-source-census'),
        childIdentityDigest: runLock.liveEnvironmentCensusChildIdentityDigest,
        ...liveExecutionStableAuthority(runLock.liveEnvironment),
        exitCode: 0,
        signal: null,
        identityUnchanged: true,
      });
    } catch (error) {
      fail('invalid_execution_receipt', `persisted census execution receipt failed validation: ${error.message}`);
    }
    if (
      liveExecutionReceiptBindingDigest(validatedExecution) !==
      liveExecutionReceiptBindingDigest(censusExecutionReceipt)
    ) {
      fail('resume_digest_mismatch', 'persisted census wrapper binding changed');
    }
    if (existingCensus) {
      assertEqual(
        liveSourceInputFromEvidence(existingCensus, validatedExecution),
        runLock.sourceInput,
        'resume_digest_mismatch',
        'persisted live source input',
      );
    }
  }
  return { existingLock, existingManifest, existingCensus, existingExecution };
}

export function validateFrozenRunLock(currentRunLock, frozenRunLock) {
  validateRunLockIntegrity(currentRunLock);
  validateRunLockIntegrity(frozenRunLock);
  if (currentRunLock.inputDigest !== frozenRunLock.inputDigest) {
    fail('resume_digest_mismatch', 'current Realm/Nimi/full-data inputs differ from the frozen run');
  }
  assertEqual(currentRunLock, frozenRunLock, 'resume_digest_mismatch', 'current run lock');
  return frozenRunLock;
}

function downstreamPartitionStages(stage) {
  if (stage === 'captured-replay') return ['live-materialize', 'restart-offline'];
  if (stage === 'live-materialize') return ['restart-offline'];
  return [];
}

async function invalidateDownstreamEvidence(evidenceDir, stage, partition) {
  for (const downstream of downstreamPartitionStages(stage)) {
    await rm(receiptPath(evidenceDir, downstream, partition.partitionKey), { force: true });
    await rm(path.join(evidenceDir, 'stages', `${downstream}.json`), { force: true });
  }
}

async function assertCloseHasNotStarted(evidenceDir) {
  for (const name of [
    'close-candidate.json',
    'live-environment-cleanup-receipt.json',
    'runtime-cleanup.json',
    'final-aggregate.json',
  ]) {
    try {
      await lstat(path.join(evidenceDir, name));
      fail('close_already_started', `partition stages cannot run after ${name} exists`);
    } catch (error) {
      if (error instanceof FullDataContractError) throw error;
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

async function runPartitionStage({
  stage,
  worker,
  workerArgs = [],
  workerChildExecutable = null,
  workerInputPaths = [],
  evidenceDir,
  realmEvidence,
  runtimeDataRoot,
  runLock,
  manifest,
  resume,
  progressIntervalMs = PROGRESS_INTERVAL_MS,
}) {
  if (!worker) fail('missing_partition_worker', `${stage} requires an explicit worker executable`);
  await invalidatePriorAggregate(evidenceDir, runLock);
  if (stage === 'captured-replay' && runLock.sourceInput.mode !== 'historical_capture_development') {
    fail('captured_stage_forbidden', 'current live source runs cannot execute historical captured replay');
  }
  if (!resume) {
    const prior = await selectPartitionsForResume({ evidenceDir, stage, manifest, runLock });
    if (prior.reused.length > 0 || prior.priorFailures.length > 0) {
      fail('resume_required', `${stage} already has partition evidence; rerun with --resume`);
    }
  }
  const selection = await selectPartitionsForResume({ evidenceDir, stage, manifest, runLock });
  const startedAt = Date.now();
  let completed = selection.reused.length;
  let failed = 0;
  let executed = 0;
  emitProgress({
    stage,
    partition: selection.pending[0]?.ordinal ?? 'none',
    completed,
    failed,
    startedAt,
    recent: `resume reused ${selection.reused.length} verified PASS partitions`,
  });
  for (const partition of selection.pending) {
    await invalidateDownstreamEvidence(evidenceDir, stage, partition);
    const heartbeat = () =>
      emitProgress({
        stage,
        partition: `${partition.ordinal}:${partition.partitionKey.slice(0, 12)}`,
        completed,
        failed,
        startedAt,
        recent: 'partition worker remains active',
      });
    const receipt = await invokeWorker({
      worker,
      workerArgs,
      workerChildExecutable,
      workerInputPaths,
      stage,
      partition,
      runLock,
      evidenceDir,
      realmEvidence,
      runtimeDataRoot,
      onHeartbeat: heartbeat,
      progressIntervalMs,
    });
    await writeJSONAtomic(receiptPath(evidenceDir, stage, partition.partitionKey), receipt);
    executed += 1;
    completed += 1;
    if (receipt.status === 'FAIL') failed += 1;
  }
  const receipts = [];
  for (const partition of manifest.partitions) {
    const receipt = await existingReceipt(evidenceDir, stage, partition, runLock);
    if (!receipt) fail('missing_partition_receipt', `${stage} partition ${partition.ordinal} has no receipt`);
    receipts.push(receipt);
  }
  failed = receipts.filter((receipt) => receipt.status === 'FAIL').length;
  const passed = receipts.filter((receipt) => receipt.status === 'PASS').length;
  const stageReport = {
    schemaVersion: STAGE_REPORT_SCHEMA,
    stage,
    evidenceClass: runLock.evidenceClass,
    inputDigest: runLock.inputDigest,
    manifestDigest: manifest.manifestDigest,
    denominator: FULL_DATA_DENOMINATOR,
    processed: receipts.length,
    passed,
    failed,
    skipped: 0,
    reused: selection.reused.length,
    executed,
    resumable: true,
    status: passed === FULL_DATA_DENOMINATOR && failed === 0 ? 'PASS' : 'FAIL',
    receiptSetDigest: orderedReceiptSetDigest(stage, receipts),
  };
  stageReport.contentHash = domainHash('nimi.realm-v3-full-data-stage-report/v1', stageReport);
  await writeJSONAtomic(path.join(evidenceDir, 'stages', `${stage}.json`), stageReport);
  emitProgress({
    stage,
    partition: 'complete',
    completed: receipts.length,
    failed,
    startedAt,
    recent: `${passed} PASS receipts validated`,
  });
  if (stageReport.status !== 'PASS') {
    fail('partition_stage_failed', `${stage} has ${failed} failed partitions`);
  }
  return stageReport;
}


export {
  admitOrWriteExactPreflightArtifact,
  assembleLivePartitionReceipt,
  assertCloseHasNotStarted,
  assertFrozenRunInputs,
  censusIdentityFromRunLock,
  downstreamPartitionStages,
  emitProgress,
  existingReceipt,
  formatElapsed,
  invalidateDownstreamEvidence,
  invokeWorker,
  orderedReceiptSetDigest,
  persistLiveCensusEvidence,
  receiptPath,
  runPartitionStage,
  safeFailureReceipt,
  validateExistingPreflightArtifacts,
  validatePersistedLiveCensusEvidence,
  workerRequest,
};

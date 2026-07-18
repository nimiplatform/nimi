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
  RUNTIME_CLEANUP_SCHEMA,
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

import {
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
  selectPartitionsForResume,
  validateExistingPreflightArtifacts,
  validateFrozenRunLock,
  validatePersistedLiveCensusEvidence,
  workerRequest,
} from './realm-v3-full-data-execution.mjs';
function compareMaterialization(left, right, label, { includeLocalAgentRefHash = true } = {}) {
  const semanticLeft = {
    snapshotSchema: left.snapshotSchema,
    snapshotHash: left.snapshotHash,
    materializationContextHash: left.materializationContextHash,
    sourceLaneSemanticHashes: left.sourceLaneSemanticHashes,
    sourceLaneItemCounts: left.sourceLaneItemCounts,
    sourceLanesHash: left.sourceLanesHash,
    ...(includeLocalAgentRefHash ? { localAgentRefHash: left.localAgentRefHash } : {}),
  };
  const semanticRight = {
    snapshotSchema: right.snapshotSchema,
    snapshotHash: right.snapshotHash,
    materializationContextHash: right.materializationContextHash,
    sourceLaneSemanticHashes: right.sourceLaneSemanticHashes,
    sourceLaneItemCounts: right.sourceLaneItemCounts,
    sourceLanesHash: right.sourceLanesHash,
    ...(includeLocalAgentRefHash ? { localAgentRefHash: right.localAgentRefHash } : {}),
  };
  assertEqual(semanticLeft, semanticRight, 'materialization_parity_mismatch', label);
}

function requiredPartitionStages(manifest) {
  return manifest.sourceMode === 'historical_capture_development'
    ? [...PARTITION_STAGES]
    : ['live-materialize', 'restart-offline'];
}

function aggregateNameForRun(runLock) {
  return runLock.evidenceClass === 'final_candidate'
    ? 'final-aggregate.json'
    : 'development-aggregate.json';
}

async function invalidatePriorAggregate(evidenceDir, runLock) {
  const aggregateName = aggregateNameForRun(runLock);
  const otherAggregateName = aggregateName === 'final-aggregate.json'
    ? 'development-aggregate.json'
    : 'final-aggregate.json';
  try {
    await lstat(path.join(evidenceDir, otherAggregateName));
    fail('orphan_evidence', `evidence contains foreign aggregate ${otherAggregateName}`);
  } catch (error) {
    if (error instanceof FullDataContractError) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
  const aggregatePath = path.join(evidenceDir, aggregateName);
  let info;
  try {
    info = await lstat(aggregatePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    fail('invalid_aggregate', 'prior aggregate is not a regular non-symlink file');
  }
  const aggregate = await readJSON(aggregatePath, 'prior full-data aggregate');
  if (
    aggregate?.schemaVersion !== AGGREGATE_SCHEMA ||
    aggregate?.evidenceClass !== (runLock.evidenceClass === 'final_candidate' ? 'final' : 'development_resume') ||
    aggregate?.inputDigest !== runLock.inputDigest ||
    aggregate?.sourceDenominator !== FULL_DATA_DENOMINATOR ||
    aggregate?.passed !== FULL_DATA_DENOMINATOR ||
    aggregate?.failed !== 0 ||
    aggregate?.skipped !== 0 ||
    aggregate?.disposableRuntimeResidue !== 0
  ) {
    fail('invalid_aggregate', 'prior aggregate is not a completed artifact for the frozen run');
  }
  assertSHA256(aggregate.contentHash, 'prior aggregate contentHash');
  const digestInput = { ...aggregate };
  delete digestInput.contentHash;
  if (domainHash(AGGREGATE_SCHEMA, digestInput) !== aggregate.contentHash) {
    fail('invalid_aggregate', 'prior aggregate content hash does not match');
  }
  await rm(aggregatePath, { force: false });
}

async function requireRegularEvidenceFile(filePath, label) {
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    fail('missing_evidence', `${label} is unavailable: ${error.message}`);
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    fail('invalid_evidence_path', `${label} must be a regular non-symlink file`);
  }
}

async function validateEvidenceTopology(
  evidenceDir,
  manifest,
  stages,
  admittedTopLevelArtifacts = [],
) {
  const liveCensusArtifacts = manifest.sourceMode === 'current_realm_live_census'
    ? ['source-census.json', 'census-execution-receipt.json']
    : [];
  const admittedTopLevel = new Set([
    '.work',
    'run-lock.json',
    'partition-manifest.json',
    'partitions',
    'stages',
    ...liveCensusArtifacts,
    ...admittedTopLevelArtifacts,
  ]);
  const requiredTopLevel = new Set([
    '.work',
    'run-lock.json',
    'partition-manifest.json',
    'partitions',
    'stages',
    ...liveCensusArtifacts,
  ]);
  const topLevelEntries = await readdir(evidenceDir, { withFileTypes: true });
  for (const entry of topLevelEntries) {
    if (!admittedTopLevel.has(entry.name)) {
      fail('orphan_evidence', `full-data evidence contains unowned top-level entry ${entry.name}`);
    }
    requiredTopLevel.delete(entry.name);
    const absolutePath = path.join(evidenceDir, entry.name);
    if (['.work', 'partitions', 'stages'].includes(entry.name)) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        fail('invalid_evidence_path', `${entry.name} must be a regular directory`);
      }
    } else {
      await requireRegularEvidenceFile(absolutePath, `top-level evidence ${entry.name}`);
    }
  }
  if (requiredTopLevel.size > 0) {
    fail('missing_evidence', `full-data evidence is missing ${[...requiredTopLevel].sort().join(', ')}`);
  }

  const partitionsRoot = path.join(evidenceDir, 'partitions');
  let partitionEntries;
  try {
    partitionEntries = await readdir(partitionsRoot, { withFileTypes: true });
  } catch (error) {
    fail('missing_partition_receipt', `partition evidence directory is unavailable: ${error.message}`);
  }
  const expectedPartitions = new Set(manifest.partitions.map((partition) => partition.partitionKey));
  if (partitionEntries.length !== expectedPartitions.size) {
    fail('orphan_partition', 'partition evidence directory count does not equal the frozen manifest');
  }
  const expectedReceiptNames = new Set(stages.map((stage) => `${stage}.json`));
  for (const entry of partitionEntries) {
    if (!entry.isDirectory() || !expectedPartitions.has(entry.name)) {
      fail('orphan_partition', `partition evidence contains unowned entry ${entry.name}`);
    }
    const partitionDirectory = path.join(partitionsRoot, entry.name);
    const entries = await readdir(partitionDirectory, { withFileTypes: true });
    if (entries.length !== expectedReceiptNames.size) {
      fail('orphan_partition_receipt', `partition ${entry.name} receipt set is not exact`);
    }
    for (const receiptEntry of entries) {
      if (!receiptEntry.isFile() || !expectedReceiptNames.has(receiptEntry.name)) {
        fail('orphan_partition_receipt', `partition ${entry.name} contains unowned receipt ${receiptEntry.name}`);
      }
      await requireRegularEvidenceFile(
        path.join(partitionDirectory, receiptEntry.name),
        `partition ${entry.name} receipt ${receiptEntry.name}`,
      );
    }
  }

  const stagesRoot = path.join(evidenceDir, 'stages');
  let stageEntries;
  try {
    stageEntries = await readdir(stagesRoot, { withFileTypes: true });
  } catch (error) {
    fail('missing_stage_report', `stage evidence directory is unavailable: ${error.message}`);
  }
  const expectedStageNames = new Set(stages.map((stage) => `${stage}.json`));
  if (stageEntries.length !== expectedStageNames.size) {
    fail('orphan_stage_report', 'stage report set is not exact for this source mode');
  }
  for (const entry of stageEntries) {
    if (!entry.isFile() || !expectedStageNames.has(entry.name)) {
      fail('orphan_stage_report', `stage evidence contains unowned entry ${entry.name}`);
    }
    await requireRegularEvidenceFile(path.join(stagesRoot, entry.name), `stage report ${entry.name}`);
  }

  const workRoot = path.join(evidenceDir, '.work');
  try {
    const info = await lstat(workRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      fail('raw_transport_residue', 'full-data work path is not a regular directory');
    }
    if ((await readdir(workRoot)).length !== 0) {
      fail('raw_transport_residue', 'full-data work directory retained request or receipt material');
    }
  } catch (error) {
    if (error instanceof FullDataContractError) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function validateStageReport({ evidenceDir, stage, receipts, runLock, manifest }) {
  const report = await readJSON(path.join(evidenceDir, 'stages', `${stage}.json`), `${stage} stage report`);
  assertClosedObject(
    report,
    [
      'schemaVersion',
      'stage',
      'evidenceClass',
      'inputDigest',
      'manifestDigest',
      'denominator',
      'processed',
      'passed',
      'failed',
      'skipped',
      'reused',
      'executed',
      'resumable',
      'status',
      'receiptSetDigest',
      'contentHash',
    ],
    [],
    `${stage} stage report`,
  );
  if (
    report.schemaVersion !== STAGE_REPORT_SCHEMA ||
    report.stage !== stage ||
    report.evidenceClass !== runLock.evidenceClass ||
    report.inputDigest !== runLock.inputDigest ||
    report.manifestDigest !== manifest.manifestDigest
  ) {
    fail('stage_report_identity_mismatch', `${stage} stage report does not belong to the frozen run`);
  }
  const passed = receipts.filter((receipt) => receipt.status === 'PASS').length;
  const failed = receipts.length - passed;
  if (
    report.denominator !== FULL_DATA_DENOMINATOR ||
    report.processed !== receipts.length ||
    report.passed !== passed ||
    report.failed !== failed ||
    report.skipped !== 0 ||
    !Number.isSafeInteger(report.reused) ||
    report.reused < 0 ||
    !Number.isSafeInteger(report.executed) ||
    report.executed < 0 ||
    report.reused + report.executed !== FULL_DATA_DENOMINATOR ||
    report.resumable !== true ||
    report.status !== 'PASS'
  ) {
    fail('stage_report_count_mismatch', `${stage} stage report counts do not match its receipts`);
  }
  assertSHA256(report.receiptSetDigest, `${stage} stage report receiptSetDigest`);
  if (report.receiptSetDigest !== orderedReceiptSetDigest(stage, receipts)) {
    fail('stage_receipt_set_mismatch', `${stage} stage report does not bind its ordered receipt set`);
  }
  assertSHA256(report.contentHash, `${stage} stage report contentHash`);
  const digestInput = { ...report };
  delete digestInput.contentHash;
  if (domainHash('nimi.realm-v3-full-data-stage-report/v1', digestInput) !== report.contentHash) {
    fail('stage_report_digest_mismatch', `${stage} stage report content hash does not match`);
  }
  return report;
}

export async function validateCloseAggregate({
  evidenceDir,
  runLock,
  manifest,
  admittedTopLevelArtifacts = [],
}) {
  validatePartitionManifest(manifest, runLock);
  if (runLock.evidenceClass === 'final_candidate' && runLock.upstreamEvidence === null) {
    fail('fake_final_rejected', 'final aggregate has no frozen NC6 evidence digest');
  }
  if (
    runLock.evidenceClass === 'final_candidate' &&
    runLock.sourceInput.mode !== 'current_realm_live_census'
  ) {
    fail('captured_final_forbidden', 'final aggregate cannot be built from historical capture input');
  }
  if (runLock.sourceInput.mode === 'current_realm_live_census') {
    await validatePersistedLiveCensusEvidence({ evidenceDir, runLock, manifest });
  }
  const stages = requiredPartitionStages(manifest);
  await validateEvidenceTopology(evidenceDir, manifest, stages, admittedTopLevelArtifacts);
  const stageReceipts = new Map();
  const stageReports = new Map();
  for (const stage of stages) {
    const receipts = [];
    for (const partition of manifest.partitions) {
      const receipt = await existingReceipt(evidenceDir, stage, partition, runLock);
      if (!receipt) fail('missing_partition_receipt', `${stage} partition ${partition.ordinal} is missing`);
      if (receipt.status !== 'PASS') fail('failed_partition_receipt', `${stage} partition ${partition.ordinal} is not PASS`);
      receipts.push(receipt);
    }
    stageReceipts.set(stage, receipts);
    stageReports.set(
      stage,
      await validateStageReport({ evidenceDir, stage, receipts, runLock, manifest }),
    );
  }
  let segments = 0;
  let components = 0;
  let chunks = 0;
  let canonicalBytes = 0;
  let totalAttemptGenerations = 0;
  let failedAttemptGenerations = 0;
  let recoveredPartitions = 0;
  for (const partition of manifest.partitions) {
    const index = partition.ordinal;
    const captured = stageReceipts.get('captured-replay')?.[index] ?? null;
    const live = stageReceipts.get('live-materialize')[index];
    const restart = stageReceipts.get('restart-offline')[index];
    if (captured) {
      compareMaterialization(
        captured.evidence.materialization,
        live.evidence.materialization,
        `partition ${index} captured/live semantic parity`,
        { includeLocalAgentRefHash: false },
      );
    }
    compareMaterialization(
      live.evidence.materialization,
      restart.evidence.materialization,
      `partition ${index} live/restart semantic parity`,
    );
    assertEqual(
      live.evidence.attemptGenerations,
      restart.evidence.attemptGenerations,
      'attempt_generation_mismatch',
      `partition ${index} live/restart attempt generations`,
    );
    const attemptSummary = validateAttemptGenerations(
      live.evidence.attemptGenerations,
      partition,
      `partition ${index} aggregate attempt generations`,
    );
    totalAttemptGenerations += attemptSummary.total;
    failedAttemptGenerations += attemptSummary.failed;
    if (attemptSummary.recovered) recoveredPartitions += 1;
    const transport = live.evidence.transport;
    segments += transport.segmentCount;
    components += transport.componentCount;
    chunks += transport.chunkCount;
    canonicalBytes += transport.canonicalBytes;
    if (
      live.evidence.authorization.authorizationBoundaryDigest !==
        restart.evidence.authorizationBoundaryDigest ||
      restart.evidence.authorizationStatePersisted !== false
    ) {
      fail('first_party_authorization_mismatch', `partition ${index} changed or persisted the authorization boundary`);
    }
  }
  const aggregate = {
    schemaVersion: AGGREGATE_SCHEMA,
    evidenceClass: runLock.evidenceClass === 'final_candidate' ? 'final' : 'development_resume',
    inputDigest: runLock.inputDigest,
    manifestDigest: manifest.manifestDigest,
    sourceDenominator: FULL_DATA_DENOMINATOR,
    worldCharacters: WORLD_CHARACTER_DENOMINATOR,
    personaCharacters: PERSONA_CHARACTER_DENOMINATOR,
    processed: FULL_DATA_DENOMINATOR,
    passed: FULL_DATA_DENOMINATOR,
    failed: 0,
    skipped: 0,
    orphanPartitions: 0,
    orphanLocalAgents: 0,
    orphanSnapshots: 0,
    orphanProvenance: 0,
    accountCustodyResidue: 0,
    rawTransportResidue: 0,
    disposableRuntimeResidue: null,
    segments,
    components,
    chunks,
    canonicalBytes,
    coldStarts: 2,
    restartParity: 'passed',
    offlineParity: 'passed',
    fiveLaneParity: 'passed',
    authorizationBoundary: {
      ...runLock.authorizationBoundary,
      digest: domainHash(
        'nimi.realm-v3-full-data-authorization-boundary/v1',
        runLock.authorizationBoundary,
      ),
      authorizationStatePersisted: false,
      passed: true,
    },
    capturedStructuralReplayPartitions: stageReceipts.has('captured-replay')
      ? FULL_DATA_DENOMINATOR
      : 0,
    capturedReplayCountsTowardCurrentAuthorization: false,
    currentRealmLiveAuthorizationPartitions: FULL_DATA_DENOMINATOR,
    attemptGenerationSummary: {
      totalGenerations: totalAttemptGenerations,
      failedGenerations: failedAttemptGenerations,
      committedGenerations: FULL_DATA_DENOMINATOR,
      recoveredPartitions,
    },
    stageEvidenceDigests: Object.fromEntries(
      stages.map((stage) => {
        const report = stageReports.get(stage);
        return [stage, {
          stageReportContentHash: report.contentHash,
          receiptSetDigest: report.receiptSetDigest,
        }];
      }),
    ),
    nimiCandidate: {
      commit: runLock.nimi.commit,
      tree: runLock.nimi.tree,
      contractDigest: runLock.nimi.consumerContractDigest,
      worktreeDigest: runLock.nimi.worktreeDigest,
      worktreeClean: runLock.nimi.worktreeClean,
    },
    realmCandidate: {
      commit: runLock.realm.commit,
      tree: runLock.realm.tree,
      openapiDigest: runLock.realm.openapiDigest,
      policyDigest: runLock.realm.accessPolicyDigest,
    },
  };
  aggregate.contentHash = domainHash('nimi.realm-v3-full-data-aggregate/v1', aggregate);
  return aggregate;
}

function buildCloseCandidate(aggregate, runLock) {
  if (
    aggregate.schemaVersion !== AGGREGATE_SCHEMA ||
    aggregate.inputDigest !== runLock.inputDigest ||
    aggregate.passed !== FULL_DATA_DENOMINATOR ||
    aggregate.failed !== 0 ||
    aggregate.skipped !== 0 ||
    aggregate.rawTransportResidue !== 0 ||
    aggregate.orphanLocalAgents !== 0 ||
    aggregate.orphanSnapshots !== 0 ||
    aggregate.orphanProvenance !== 0
  ) {
    fail('invalid_close_candidate', 'aggregate is not eligible for external cleanup');
  }
  assertSHA256(aggregate.contentHash, 'aggregate candidate contentHash');
  const candidate = {
    schemaVersion: CLOSE_CANDIDATE_SCHEMA,
    status: 'PASS',
    reasonCode: 'passed',
    inputDigest: runLock.inputDigest,
    liveEnvironmentAttestationDigest: runLock.liveEnvironmentAttestationDigest,
    aggregateCandidateDigest: aggregate.contentHash,
    acceptance: {
      total: FULL_DATA_DENOMINATOR,
      passed: FULL_DATA_DENOMINATOR,
      failed: 0,
      skipped: 0,
      orphanProductRecords: 0,
      rawTransportResidue: 0,
      externalCleanup: 'pending',
    },
  };
  candidate.contentHash = domainHash(CLOSE_CANDIDATE_SCHEMA, candidate);
  return candidate;
}

function validateCloseCandidate(candidate, runLock, aggregate = null) {
  assertClosedObject(
    candidate,
    [
      'schemaVersion',
      'status',
      'reasonCode',
      'inputDigest',
      'liveEnvironmentAttestationDigest',
      'aggregateCandidateDigest',
      'acceptance',
      'contentHash',
    ],
    [],
    'close candidate',
  );
  assertClosedObject(
    candidate.acceptance,
    [
      'total',
      'passed',
      'failed',
      'skipped',
      'orphanProductRecords',
      'rawTransportResidue',
      'externalCleanup',
    ],
    [],
    'close candidate acceptance',
  );
  if (
    candidate.schemaVersion !== CLOSE_CANDIDATE_SCHEMA ||
    candidate.status !== 'PASS' ||
    candidate.reasonCode !== 'passed' ||
    candidate.inputDigest !== runLock.inputDigest ||
    candidate.liveEnvironmentAttestationDigest !== runLock.liveEnvironmentAttestationDigest ||
    candidate.acceptance.total !== FULL_DATA_DENOMINATOR ||
    candidate.acceptance.passed !== FULL_DATA_DENOMINATOR ||
    candidate.acceptance.failed !== 0 ||
    candidate.acceptance.skipped !== 0 ||
    candidate.acceptance.orphanProductRecords !== 0 ||
    candidate.acceptance.rawTransportResidue !== 0 ||
    candidate.acceptance.externalCleanup !== 'pending'
  ) {
    fail('invalid_close_candidate', 'close candidate does not prove exact pending 471/471 cleanup');
  }
  assertSHA256(candidate.aggregateCandidateDigest, 'close candidate aggregateCandidateDigest');
  assertSHA256(candidate.contentHash, 'close candidate contentHash');
  const digestInput = { ...candidate };
  delete digestInput.contentHash;
  if (
    domainHash(CLOSE_CANDIDATE_SCHEMA, digestInput) !== candidate.contentHash ||
    (aggregate && candidate.aggregateCandidateDigest !== aggregate.contentHash)
  ) {
    fail('invalid_close_candidate', 'close candidate content or aggregate binding mismatch');
  }
  return candidate;
}

async function loadCloseCandidate(evidenceDir, runLock, aggregate, required) {
  const candidate = await loadOptionalPrivateEvidenceArtifact(
    path.join(evidenceDir, 'close-candidate.json'),
    'full-data close candidate',
  );
  if (!candidate) {
    if (required) fail('missing_close_candidate', 'final cleanup requires a durable close candidate');
    return null;
  }
  return validateCloseCandidate(candidate, runLock, aggregate);
}

async function loadLiveCleanupReceipt(evidenceDir, receiptPath, runLock, candidate) {
  if (!receiptPath || !path.isAbsolute(receiptPath)) {
    fail('missing_cleanup_receipt', 'final close requires an absolute live environment cleanup receipt');
  }
  const expectedPath = path.join(evidenceDir, 'live-environment-cleanup-receipt.json');
  const resolvedPath = path.resolve(receiptPath);
  const canonicalPath = canonicalPathThroughExistingAncestor(resolvedPath, 'live environment cleanup receipt');
  if (resolvedPath !== expectedPath || canonicalPath !== expectedPath) {
    fail(
      'unsafe_cleanup_receipt_path',
      'live environment cleanup receipt must use the frozen evidence directory and exact basename',
    );
  }
  const receipt = await loadOptionalPrivateEvidenceArtifact(
    canonicalPath,
    'live environment cleanup receipt',
  );
  if (!receipt) fail('missing_cleanup_receipt', 'live environment cleanup receipt is unavailable');
  try {
    return validateLiveEnvironmentCleanupReceipt(receipt, {
      environmentAttestationDigest: runLock.liveEnvironmentAttestationDigest,
      runInputDigest: runLock.inputDigest,
      closeCandidateDigest: candidate.contentHash,
    });
  } catch (error) {
    fail('invalid_cleanup_receipt', `live environment cleanup receipt failed validation: ${error.message}`);
  }
}

function buildCompletedFinalAggregate(
  aggregateCandidate,
  runLock,
  closeCandidate,
  externalCleanupReceipt,
  runtimeCleanupReceipt,
) {
  validateCloseCandidate(closeCandidate, runLock, aggregateCandidate);
  let validatedExternalCleanup;
  try {
    validatedExternalCleanup = validateLiveEnvironmentCleanupReceipt(externalCleanupReceipt, {
      environmentAttestationDigest: runLock.liveEnvironmentAttestationDigest,
      runInputDigest: runLock.inputDigest,
      closeCandidateDigest: closeCandidate.contentHash,
    });
  } catch (error) {
    fail('invalid_cleanup_receipt', `live environment cleanup receipt failed validation: ${error.message}`);
  }
  if (
    runtimeCleanupReceipt?.schemaVersion !== RUNTIME_CLEANUP_SCHEMA ||
    runtimeCleanupReceipt.inputDigest !== runLock.inputDigest ||
    runtimeCleanupReceipt.runtimeDataRootDigest !== runLock.runtimeDataRootDigest ||
    runtimeCleanupReceipt.status !== 'PASS' ||
    runtimeCleanupReceipt.reasonCode !== 'passed' ||
    runtimeCleanupReceipt.residue !== 0
  ) {
    fail('runtime_root_cleanup_failed', 'runtime cleanup receipt is not a completed frozen-target proof');
  }
  assertSHA256(runtimeCleanupReceipt.contentHash, 'runtime cleanup receipt contentHash');
  const runtimeDigestInput = { ...runtimeCleanupReceipt };
  delete runtimeDigestInput.contentHash;
  if (domainHash(RUNTIME_CLEANUP_SCHEMA, runtimeDigestInput) !== runtimeCleanupReceipt.contentHash) {
    fail('runtime_root_cleanup_failed', 'runtime cleanup receipt content hash does not match');
  }
  const completed = {
    ...aggregateCandidate,
    aggregateCandidateDigest: aggregateCandidate.contentHash,
    liveEnvironmentAttestationDigest: runLock.liveEnvironmentAttestationDigest,
    closeCandidateDigest: closeCandidate.contentHash,
    externalEnvironmentResidue: 0,
    disposableRuntimeResidue: 0,
    cleanupEvidence: {
      external: {
        receiptContentHash: validatedExternalCleanup.contentHash,
        apiProcessResidue: 0,
        disposableDatabaseResidue: validatedExternalCleanup.disposableDatabase.residue,
        redisKeyResidue: validatedExternalCleanup.redis.keysAfterCleanup,
        redisContainerResidue: validatedExternalCleanup.redis.containerResidue,
        temporaryResidue: validatedExternalCleanup.temporaryResidue,
        persistentParity: validatedExternalCleanup.persistentParity,
        writeBoundary: validatedExternalCleanup.writeBoundary,
      },
      runtime: {
        receiptContentHash: runtimeCleanupReceipt.contentHash,
        runtimeDataRootDigest: runtimeCleanupReceipt.runtimeDataRootDigest,
        quarantineDigest: runtimeCleanupReceipt.quarantineDigest,
        residue: runtimeCleanupReceipt.residue,
      },
    },
  };
  delete completed.contentHash;
  completed.contentHash = domainHash(AGGREGATE_SCHEMA, completed);
  return completed;
}

async function admitOrWriteCompletedAggregate(evidenceDir, expectedAggregate) {
  const aggregatePath = path.join(evidenceDir, 'final-aggregate.json');
  const existing = await loadOptionalPrivateEvidenceArtifact(
    aggregatePath,
    'completed full-data aggregate',
  );
  if (existing) {
    assertEqual(existing, expectedAggregate, 'invalid_aggregate', 'completed full-data aggregate');
    return existing;
  }
  await writeJSONAtomic(aggregatePath, expectedAggregate);
  return expectedAggregate;
}


export {
  admitOrWriteCompletedAggregate,
  aggregateNameForRun,
  buildCloseCandidate,
  buildCompletedFinalAggregate,
  compareMaterialization,
  invalidatePriorAggregate,
  loadCloseCandidate,
  loadLiveCleanupReceipt,
  requireRegularEvidenceFile,
  requiredPartitionStages,
  validateCloseCandidate,
  validateEvidenceTopology,
  validateStageReport,
};

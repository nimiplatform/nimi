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

import {
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
  validateCloseAggregate,
  validateCloseCandidate,
  validateEvidenceTopology,
  validateStageReport,
} from './realm-v3-full-data-close.mjs';

export {
  FullDataContractError,
  FULL_DATA_DENOMINATOR,
  FULL_DATA_STAGES,
  PARTITION_STAGES,
  PERSONA_CHARACTER_DENOMINATOR,
  SOURCE_LANES,
  WORLD_CHARACTER_DENOMINATOR,
  canonicalJSONStringify,
  sha256Hex,
} from './realm-v3-full-data-contract.mjs';
export {
  buildRunLock,
} from './realm-v3-full-data-run-lock.mjs';
export { validateSourceCensus } from './realm-v3-full-data-preflight.mjs';
export {
  buildPartitionManifest,
  validatePartitionManifest,
  validatePartitionReceipt,
} from './realm-v3-full-data-manifest.mjs';
export {
  selectPartitionsForResume,
  validateFrozenRunLock,
} from './realm-v3-full-data-execution.mjs';
export {
  validateCloseAggregate,
} from './realm-v3-full-data-close.mjs';
export async function runFullDataStage(options) {
  assertNoAmbientNodeInjection();
  const {
    nimiRoot,
    realmEvidence,
    evidenceDir: evidenceDirInput,
    runtimeDataRoot: runtimeDataRootInput = null,
    stage,
    mode = 'development',
    resume = false,
    worker = null,
    workerArgs = [],
    workerChildExecutable = null,
    workerInputPaths = [],
    sourceMode = mode === 'final' ? 'live' : 'captured',
    liveEnvironmentAttestationPath = null,
    liveCleanupReceiptPath = null,
    censusWorker = null,
    censusWorkerArgs = [],
    censusWorkerChildExecutable = null,
    censusWorkerInputPaths = [],
    upstreamEvidencePath = null,
    progressIntervalMs = PROGRESS_INTERVAL_MS,
  } = options;
  if (!FULL_DATA_STAGES.includes(stage)) fail('invalid_stage', `stage ${stage} is not admitted`);
  if (liveCleanupReceiptPath !== null && (stage !== 'close' || mode !== 'final')) {
    fail('invalid_cleanup_receipt', 'a live cleanup receipt is admitted only for final close');
  }
  const evidenceDir = validateEvidenceDirectory(nimiRoot, evidenceDirInput);
  const liveEnvironmentBinding = sourceMode === 'live'
    ? await loadLiveEnvironmentAttestation(nimiRoot, liveEnvironmentAttestationPath)
    : null;
  const liveEnvironment = liveEnvironmentBinding?.liveEnvironmentProjection ?? null;
  const liveEnvironmentAttestationDigest = liveEnvironmentBinding?.attestationDigest ?? null;
  const liveEnvironmentAttestationFileSha256 = liveEnvironmentBinding?.fileSha256 ?? null;
  const liveEnvironmentWrapperRegistrationDigest =
    liveEnvironmentBinding?.wrapperRegistrationDigest ?? null;
  const liveEnvironmentWrapperIdentityDigest =
    liveEnvironmentBinding?.wrapperIdentityDigest ?? null;
  const liveEnvironmentCensusChildIdentityDigest =
    liveEnvironmentBinding?.censusChildIdentityDigest ?? null;
  const liveEnvironmentPartitionChildIdentityDigest =
    liveEnvironmentBinding?.partitionChildIdentityDigest ?? null;
  const runtimeDataRoot = validateRuntimeDataRoot(
    nimiRoot,
    runtimeDataRootInput,
    true,
  );
  const lockFile = path.join(evidenceDir, 'run-lock.json');
  const manifestFile = path.join(evidenceDir, 'partition-manifest.json');
  const lockOptions = {
    nimiRoot,
    realmEvidence,
    runtimeDataRoot,
    mode,
    upstreamEvidencePath,
    sourceMode,
    liveEnvironment,
    liveEnvironmentAttestationDigest,
    liveEnvironmentAttestationFileSha256,
    liveEnvironmentWrapperRegistrationDigest,
    liveEnvironmentWrapperIdentityDigest,
    liveEnvironmentCensusChildIdentityDigest,
    liveEnvironmentPartitionChildIdentityDigest,
    partitionWorker: worker,
    partitionWorkerArgs: workerArgs,
    partitionWorkerChildExecutable: workerChildExecutable,
    partitionWorkerInputPaths: workerInputPaths,
    censusWorker,
    censusWorkerArgs,
    censusWorkerChildExecutable,
    censusWorkerInputPaths,
  };
  if (stage === 'preflight') {
    await ensurePrivateEvidenceDirectory(evidenceDir);
    const initialEntries = await readdir(evidenceDir);
    if (!resume && initialEntries.length > 0) {
      fail('resume_required', 'full-data evidence already exists; use --resume');
    }
    if (resume) await assertCloseHasNotStarted(evidenceDir);
    const censusExecution = sourceMode === 'live'
      ? await invokeCensusWorker({
          nimiRoot,
          evidenceDir,
          worker: censusWorker,
          workerArgs: censusWorkerArgs,
          workerChildExecutable: censusWorkerChildExecutable,
          workerInputPaths: censusWorkerInputPaths,
          liveEnvironmentAttestationDigest,
          liveEnvironmentWrapperIdentityDigest,
          liveEnvironmentWrapperRegistrationDigest,
          liveEnvironmentCensusChildIdentityDigest,
          liveEnvironment,
          progressIntervalMs,
        })
      : null;
    const built = await buildRunLock({
      ...lockOptions,
      sourceCensus: censusExecution?.census ?? null,
      censusExecutionReceipt: censusExecution?.executionReceipt ?? null,
    });
    const startedAt = Date.now();
    const manifest = await buildPartitionManifest({
      runLock: built.runLock,
      captureIndex: built.captureIndex,
      captureIndexPath: built.captureIndexPath,
      realmEvidence,
      sourceCensus: built.sourceCensus,
      onProgress: ({ completed, partition }) => {
        if (completed === 1 || completed === FULL_DATA_DENOMINATOR) {
          emitProgress({
            stage,
            partition,
            completed,
            failed: 0,
            startedAt,
            recent: sourceMode === 'live'
              ? 'live source census partitions frozen'
              : 'captured partition input digests validated',
          });
        }
      },
    });
    await validateExistingPreflightArtifacts({
      lockFile,
      manifestFile,
      evidenceDir,
      runLock: built.runLock,
      manifest,
      sourceCensus: built.sourceCensus,
      censusExecutionReceipt: censusExecution?.executionReceipt ?? null,
    });
    await invalidatePriorAggregate(evidenceDir, built.runLock);
    await initializePreflightRuntimeDataRoot(runtimeDataRoot, built.runLock, resume);
    await admitOrWriteExactPreflightArtifact(
      lockFile,
      built.runLock,
      'frozen full-data run lock',
    );
    await admitOrWriteExactPreflightArtifact(
      manifestFile,
      manifest,
      'full-data partition manifest',
    );
    if (sourceMode === 'live') {
      await persistLiveCensusEvidence({
        evidenceDir,
        runLock: built.runLock,
        manifest,
        sourceCensus: built.sourceCensus,
        executionReceipt: censusExecution.executionReceipt,
      });
    }
    return { runLock: built.runLock, manifest };
  }
  const runLock = validateRunLockIntegrity(await readJSON(lockFile, 'frozen full-data run lock'));
  if ((mode === 'final') !== (runLock.evidenceClass === 'final_candidate')) {
    fail('run_mode_mismatch', 'requested mode does not match the frozen run lock');
  }
  const frozenSourceMode = runLock.sourceInput.mode === 'current_realm_live_census'
    ? 'live'
    : 'captured';
  if (sourceMode !== frozenSourceMode) {
    fail('source_mode_mismatch', 'requested source mode does not match the frozen run lock');
  }
  const currentInputs = await assertFrozenRunInputs({
    lockOptions,
    frozenRunLock: runLock,
    evidenceDir,
    censusWorker,
    censusWorkerArgs,
    censusWorkerChildExecutable,
    censusWorkerInputPaths,
    useFrozenSourceInput: stage === 'close' && mode === 'final' && liveCleanupReceiptPath !== null,
    progressIntervalMs,
  });
  const manifest = validatePartitionManifest(
    await readJSON(manifestFile, 'full-data partition manifest'),
    runLock,
  );
  if (runLock.sourceInput.mode === 'current_realm_live_census') {
    await validatePersistedLiveCensusEvidence({
      evidenceDir,
      runLock,
      manifest,
      freshSourceCensus: currentInputs.sourceCensus,
      freshExecutionReceipt: currentInputs.censusExecutionReceipt,
    });
  }
  if (PARTITION_STAGES.includes(stage)) {
    await assertCloseHasNotStarted(evidenceDir);
    await requireOwnedRuntimeDataRoot(runtimeDataRoot, runLock);
    return runPartitionStage({
      stage,
      worker,
      workerArgs,
      workerChildExecutable,
      workerInputPaths,
      evidenceDir,
      realmEvidence,
      runtimeDataRoot,
      runLock,
      manifest,
      resume,
      progressIntervalMs,
    });
  }
  if (runLock.evidenceClass === 'final_candidate') {
    const finalizing = liveCleanupReceiptPath !== null;
    if (!finalizing) await requireOwnedRuntimeDataRoot(runtimeDataRoot, runLock);
    const admittedTopLevelArtifacts = [
      'close-candidate.json',
      ...(finalizing
        ? [
            'live-environment-cleanup-receipt.json',
            'runtime-cleanup.json',
            'final-aggregate.json',
          ]
        : []),
    ];
    const aggregateCandidate = await validateCloseAggregate({
      evidenceDir,
      runLock,
      manifest,
      admittedTopLevelArtifacts,
    });
    let closeCandidate = await loadCloseCandidate(
      evidenceDir,
      runLock,
      aggregateCandidate,
      finalizing,
    );
    if (!closeCandidate) {
      closeCandidate = buildCloseCandidate(aggregateCandidate, runLock);
      await writeJSONAtomic(path.join(evidenceDir, 'close-candidate.json'), closeCandidate);
      return closeCandidate;
    }
    if (!finalizing) return closeCandidate;
    const externalCleanupReceipt = await loadLiveCleanupReceipt(
      evidenceDir,
      liveCleanupReceiptPath,
      runLock,
      closeCandidate,
    );
    const runtimeCleanupReceipt = await cleanupRuntimeDataRootResumable(
      evidenceDir,
      runtimeDataRoot,
      runLock,
    );
    const completedAggregate = buildCompletedFinalAggregate(
      aggregateCandidate,
      runLock,
      closeCandidate,
      externalCleanupReceipt,
      runtimeCleanupReceipt,
    );
    return admitOrWriteCompletedAggregate(evidenceDir, completedAggregate);
  }
  await requireOwnedRuntimeDataRoot(runtimeDataRoot, runLock);
  await invalidatePriorAggregate(evidenceDir, runLock);
  const aggregate = await validateCloseAggregate({ evidenceDir, runLock, manifest });
  await cleanupRuntimeDataRoot(runtimeDataRoot, runLock);
  aggregate.disposableRuntimeResidue = 0;
  delete aggregate.contentHash;
  aggregate.contentHash = domainHash('nimi.realm-v3-full-data-aggregate/v1', aggregate);
  const aggregateName = aggregate.evidenceClass === 'final'
    ? 'final-aggregate.json'
    : 'development-aggregate.json';
  await writeJSONAtomic(path.join(evidenceDir, aggregateName), aggregate);
  return aggregate;
}

export const __test = Object.freeze({
  ACCESS_POLICY_VERSION,
  AUTHORIZATION_BOUNDARY,
  AUTHORIZATION_INPUTS,
  FIXED_PERSONA_SOURCE,
  FIRST_PARTY_AUTHORITY_CLASS,
  FORBIDDEN_AUTHORIZATION_INPUTS,
  PACKET_OPERATION,
  RETIRED_AUTHORIZATION_ENDPOINTS,
  RETIRED_AUTHORIZATION_IDENTIFIERS,
  RUN_LOCK_SCHEMA,
  MANIFEST_SCHEMA,
  RECEIPT_SCHEMA,
  CLOSE_CANDIDATE_SCHEMA,
  SOURCE_CENSUS_SCHEMA,
  SNAPSHOT_SCHEMA,
  STAGE_REPORT_SCHEMA,
  buildCensusExpectation,
  buildCloseCandidate,
  buildCompletedFinalAggregate,
  cleanupRuntimeDataRoot,
  cleanupRuntimeDataRootResumable,
  domainHash,
  initializeRuntimeDataRoot,
  initializePreflightRuntimeDataRoot,
  invalidatePriorAggregate,
  liveSourceInputFromEvidence,
  requireOwnedRuntimeDataRoot,
  validateEvidenceDirectory,
  validateRuntimeDataRoot,
  validateCloseCandidate,
  validateCapturedEvidence,
  validateLiveEvidence,
  validateRestartEvidence,
});

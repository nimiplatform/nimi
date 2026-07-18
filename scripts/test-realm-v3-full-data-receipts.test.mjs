import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FULL_DATA_DENOMINATOR,
  FullDataContractError,
  SOURCE_LANES,
  __test,
  buildRunLock,
  canonicalJSONStringify,
  sha256Hex,
  selectPartitionsForResume,
  validateCloseAggregate,
  validatePartitionManifest,
  validatePartitionReceipt,
  validateFrozenRunLock,
  validateSourceCensus,
} from './lib/realm-v3-full-data-runner.mjs';

import {
  assembleLiveFixtureReceipt,
  capturedReceipt,
  censusIdentity,
  censusWrapperExecutionReceipt,
  createDirtyCandidateRepository,
  expectedTransport,
  externalCleanupReceipt,
  hash,
  liveEnvironmentProjection,
  liveReceipt,
  manifest,
  materialization,
  partition,
  receiptBase,
  resealLiveFixtureReceipt,
  restartReceipt,
  runLock,
  runtimeCleanupReceipt,
  sealReceipt,
  sourceCensus,
  sourceCensusForIdentity,
  wrapperExecutionReceipt,
  writePrivateJSONFixture,
  writeReceipt,
  writeRepositoryFile,
  writeStageReport,
} from './lib/realm-v3-full-data-test-fixtures.mjs';
test('partition manifest rejects missing and duplicate partitions', () => {
  const lock = runLock();
  const missing = manifest(lock);
  missing.partitions.pop();
  assert.throws(
    () => validatePartitionManifest(missing, lock),
    (error) => error instanceof FullDataContractError && error.code === 'denominator_mismatch',
  );

  const duplicate = manifest(lock);
  duplicate.partitions[1].partitionKey = duplicate.partitions[0].partitionKey;
  assert.throws(
    () => validatePartitionManifest(duplicate, lock),
    (error) => error instanceof FullDataContractError && error.code === 'duplicate_partition',
  );
});

test('resume fails closed on receipt input digest mismatch', () => {
  const lock = runLock();
  const item = partition(0, lock);
  const receipt = capturedReceipt(item, lock);
  receipt.inputDigest = hash('different-input');
  assert.throws(
    () => validatePartitionReceipt(receipt, { stage: 'captured-replay', partition: item, runLock: lock }),
    (error) => error instanceof FullDataContractError && error.code === 'resume_digest_mismatch',
  );
});

test('resume reuses only validated PASS and reruns failed or missing partitions', async (t) => {
  const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'realm-v3-full-resume-'));
  t.after(() => rm(evidenceDir, { recursive: true, force: true }));
  const lock = runLock();
  const value = manifest(lock);
  await writeReceipt(evidenceDir, 'captured-replay', value.partitions[0], capturedReceipt(value.partitions[0], lock));
  const failed = sealReceipt({
    ...receiptBase('captured-replay', value.partitions[1], lock),
    status: 'FAIL',
    reasonCode: 'packet_contract_failed',
    evidence: null,
  });
  await writeReceipt(evidenceDir, 'captured-replay', value.partitions[1], failed);
  const selection = await selectPartitionsForResume({
    evidenceDir,
    stage: 'captured-replay',
    manifest: value,
    runLock: lock,
  });
  assert.equal(selection.reused.length, 1);
  assert.equal(selection.priorFailures.length, 1);
  assert.equal(selection.pending.length, 470);
  assert.equal(selection.pending[0].ordinal, 1);
});

test('live receipt cannot relabel captured proof as current authorization', () => {
  const lock = runLock({ final: true });
  const item = partition(0, lock);
  const receipt = liveReceipt(item, lock);
  receipt.evidence.authorization.liveAuthorizationProven = false;
  resealLiveFixtureReceipt(receipt);
  assert.throws(
    () => validatePartitionReceipt(receipt, { stage: 'live-materialize', partition: item, runLock: lock }),
    (error) => error instanceof FullDataContractError && error.code === 'live_auth_missing',
  );
});

test('first-party authorization boundary and restart residue claims fail closed on mutation', () => {
  const lock = runLock({ final: true });
  const item = partition(0, lock);
  const forbiddenInput = liveReceipt(item, lock);
  forbiddenInput.evidence.authorization.forbiddenInputObserved = true;
  resealLiveFixtureReceipt(forbiddenInput);
  assert.throws(
    () => validatePartitionReceipt(forbiddenInput, { stage: 'live-materialize', partition: item, runLock: lock }),
    (error) => error instanceof FullDataContractError && error.code === 'first_party_authorization_mismatch',
  );

  const custodyResidue = restartReceipt(item, lock);
  custodyResidue.evidence.accountCustodyResidue = 1;
  resealLiveFixtureReceipt(custodyResidue);
  assert.throws(
    () => validatePartitionReceipt(custodyResidue, { stage: 'restart-offline', partition: item, runLock: lock }),
    (error) => error instanceof FullDataContractError && error.code === 'restart_offline_incomplete',
  );

  const activeGeneration = liveReceipt(item, lock);
  activeGeneration.evidence.attemptGenerations[0].status = 'active';
  activeGeneration.evidence.attemptGenerations[0].reasonCode = 'attempt_started';
  resealLiveFixtureReceipt(activeGeneration);
  assert.throws(
    () => validatePartitionReceipt(activeGeneration, { stage: 'live-materialize', partition: item, runLock: lock }),
    (error) => error instanceof FullDataContractError && error.code === 'attempt_generation_invalid',
  );

  const foreignRequest = restartReceipt(item, lock);
  foreignRequest.evidence.attemptGenerations[0].requestIdHash = hash('foreign-attempt-request');
  resealLiveFixtureReceipt(foreignRequest);
  assert.throws(
    () => validatePartitionReceipt(foreignRequest, { stage: 'restart-offline', partition: item, runLock: lock }),
    (error) => error instanceof FullDataContractError && error.code === 'attempt_generation_invalid',
  );

  for (const [field, value] of [
    ['apiProcessIntentDigest', hash('foreign-api-process-intent')],
    ['runtimeDependencyClosureDigest', hash('foreign-runtime-dependency-closure')],
  ]) {
    const foreignExecutionAuthority = liveReceipt(item, lock);
    foreignExecutionAuthority.executionReceipt[field] = value;
    delete foreignExecutionAuthority.executionReceipt.contentHash;
    foreignExecutionAuthority.executionReceipt.contentHash = __test.domainHash(
      foreignExecutionAuthority.executionReceipt.schemaVersion,
      foreignExecutionAuthority.executionReceipt,
    );
    sealReceipt(foreignExecutionAuthority);
    assert.throws(
      () => validatePartitionReceipt(foreignExecutionAuthority, {
        stage: 'live-materialize',
        partition: item,
        runLock: lock,
      }),
      (error) => error instanceof FullDataContractError && error.code === 'invalid_execution_receipt',
    );
  }
});

test('final aggregate uses only live/restart receipts and rejects a missing NC6 identity', async (t) => {
  const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'realm-v3-full-fake-final-'));
  t.after(() => rm(evidenceDir, { recursive: true, force: true }));
  const lock = runLock({ final: true });
  const value = manifest(lock);
  await mkdir(path.join(evidenceDir, '.work'), { recursive: true, mode: 0o700 });
  await writeFile(path.join(evidenceDir, 'run-lock.json'), `${JSON.stringify(lock)}\n`);
  await writeFile(path.join(evidenceDir, 'partition-manifest.json'), `${JSON.stringify(value)}\n`);
  await writePrivateJSONFixture(path.join(evidenceDir, 'source-census.json'), sourceCensus(lock));
  await writePrivateJSONFixture(
    path.join(evidenceDir, 'census-execution-receipt.json'),
    censusWrapperExecutionReceipt(lock),
  );
  const liveReceipts = [];
  const restartReceipts = [];
  for (const item of value.partitions) {
    const live = liveReceipt(item, lock);
    const restart = restartReceipt(item, lock);
    liveReceipts.push(live);
    restartReceipts.push(restart);
    await writeReceipt(evidenceDir, 'live-materialize', item, live);
    await writeReceipt(evidenceDir, 'restart-offline', item, restart);
  }
  await writeStageReport(evidenceDir, 'live-materialize', liveReceipts, lock, value);
  await writeStageReport(evidenceDir, 'restart-offline', restartReceipts, lock, value);

  const aggregate = await validateCloseAggregate({ evidenceDir, runLock: lock, manifest: value });
  assert.equal(aggregate.passed, FULL_DATA_DENOMINATOR);
  assert.equal(aggregate.capturedStructuralReplayPartitions, 0);
  assert.equal(aggregate.currentRealmLiveAuthorizationPartitions, FULL_DATA_DENOMINATOR);
  const closeCandidate = __test.buildCloseCandidate(aggregate, lock);
  assert.equal(__test.validateCloseCandidate(closeCandidate, lock, aggregate), closeCandidate);
  const externalCleanup = externalCleanupReceipt(lock, closeCandidate);
  const runtimeCleanup = runtimeCleanupReceipt(lock);
  const finalized = __test.buildCompletedFinalAggregate(
    aggregate,
    lock,
    closeCandidate,
    externalCleanup,
    runtimeCleanup,
  );
  assert.equal(finalized.disposableRuntimeResidue, 0);
  assert.equal(finalized.externalEnvironmentResidue, 0);
  assert.equal(finalized.aggregateCandidateDigest, aggregate.contentHash);
  assert.equal(finalized.cleanupEvidence.external.receiptContentHash, externalCleanup.contentHash);
  assert.equal(finalized.cleanupEvidence.runtime.receiptContentHash, runtimeCleanup.contentHash);
  const cleanupResidue = structuredClone(externalCleanup);
  cleanupResidue.disposableDatabase.residue = 1;
  cleanupResidue.contentHash = __test.domainHash(cleanupResidue.schemaVersion, cleanupResidue);
  assert.throws(
    () => __test.buildCompletedFinalAggregate(
      aggregate,
      lock,
      closeCandidate,
      cleanupResidue,
      runtimeCleanup,
    ),
    (error) => error instanceof FullDataContractError && error.code === 'invalid_cleanup_receipt',
  );
  const tamperedCloseCandidate = structuredClone(closeCandidate);
  tamperedCloseCandidate.acceptance.passed = 470;
  assert.throws(
    () => __test.validateCloseCandidate(tamperedCloseCandidate, lock, aggregate),
    (error) => error instanceof FullDataContractError && error.code === 'invalid_close_candidate',
  );
  assert.equal(
    aggregate.stageEvidenceDigests['live-materialize'].receiptSetDigest,
    __test.domainHash(
      'nimi.realm-v3-full-data-stage-receipt-set/v1',
      liveReceipts.map((receipt) => ({
        stage: 'live-materialize',
        ordinal: receipt.ordinal,
        partitionKey: receipt.partitionKey,
        contentHash: receipt.contentHash,
      })),
    ),
  );
  const completedAggregate = { ...aggregate, disposableRuntimeResidue: 0 };
  delete completedAggregate.contentHash;
  completedAggregate.contentHash = __test.domainHash(
    'nimi.realm-v3-full-data-aggregate/v1',
    completedAggregate,
  );
  const aggregatePath = path.join(evidenceDir, 'final-aggregate.json');
  await writeFile(aggregatePath, `${JSON.stringify(completedAggregate)}\n`);
  await __test.invalidatePriorAggregate(evidenceDir, lock);
  await assert.rejects(lstat(aggregatePath), (error) => error?.code === 'ENOENT');

  await writeFile(aggregatePath, '{}\n');
  await assert.rejects(
    __test.invalidatePriorAggregate(evidenceDir, lock),
    (error) => error instanceof FullDataContractError && error.code === 'invalid_aggregate',
  );
  await rm(aggregatePath);

  const tamperedLive = structuredClone(liveReceipts[0]);
  tamperedLive.evidence.materialization.snapshotHash = hash('tampered-snapshot');
  await writeReceipt(evidenceDir, 'live-materialize', value.partitions[0], tamperedLive);
  await assert.rejects(
    validateCloseAggregate({ evidenceDir, runLock: lock, manifest: value }),
    (error) => error instanceof FullDataContractError && error.code === 'receipt_digest_mismatch',
  );
  resealLiveFixtureReceipt(tamperedLive);
  await writeReceipt(evidenceDir, 'live-materialize', value.partitions[0], tamperedLive);
  await assert.rejects(
    validateCloseAggregate({ evidenceDir, runLock: lock, manifest: value }),
    (error) => error instanceof FullDataContractError && error.code === 'stage_receipt_set_mismatch',
  );
  await writeReceipt(evidenceDir, 'live-materialize', value.partitions[0], liveReceipts[0]);

  const replacementAgent = structuredClone(restartReceipts[0]);
  replacementAgent.evidence.materialization.localAgentRefHash = hash('replacement-agent');
  resealLiveFixtureReceipt(replacementAgent);
  await writeReceipt(evidenceDir, 'restart-offline', value.partitions[0], replacementAgent);
  await writeStageReport(
    evidenceDir,
    'restart-offline',
    [replacementAgent, ...restartReceipts.slice(1)],
    lock,
    value,
  );
  await assert.rejects(
    validateCloseAggregate({ evidenceDir, runLock: lock, manifest: value }),
    (error) => error instanceof FullDataContractError && error.code === 'materialization_parity_mismatch',
  );
  await writeReceipt(evidenceDir, 'restart-offline', value.partitions[0], restartReceipts[0]);
  await writeStageReport(evidenceDir, 'restart-offline', restartReceipts, lock, value);

  const rawPacket = path.join(evidenceDir, 'raw-packet.json');
  await writeFile(rawPacket, '{}\n');
  await assert.rejects(
    validateCloseAggregate({ evidenceDir, runLock: lock, manifest: value }),
    (error) => error instanceof FullDataContractError && error.code === 'orphan_evidence',
  );
  await rm(rawPacket);

  const orphanDirectory = path.join(evidenceDir, 'partitions', hash('orphan-partition'));
  await mkdir(orphanDirectory);
  await assert.rejects(
    validateCloseAggregate({ evidenceDir, runLock: lock, manifest: value }),
    (error) => error instanceof FullDataContractError && error.code === 'orphan_partition',
  );
  await rm(orphanDirectory, { recursive: true });

  const fakeLock = { ...lock, upstreamEvidence: null };
  await assert.rejects(
    validateCloseAggregate({ evidenceDir, runLock: fakeLock, manifest: value }),
    (error) => error instanceof FullDataContractError && error.code === 'fake_final_rejected',
  );
});

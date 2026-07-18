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
test('canonical JSON and manifest digest are deterministic', () => {
  assert.equal(canonicalJSONStringify({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
  const lock = runLock();
  const first = manifest(lock);
  const second = manifest(lock);
  assert.equal(first.manifestDigest, second.manifestDigest);
  assert.equal(validatePartitionManifest(first, lock), first);
});
test('disposable runtime root requires the frozen marker and is removed at close', async (t) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'realm-v3-full-runtime-root-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const runtimeRoot = path.join(await realpath(parent), 'owned-runtime');
  const lock = runLock({ final: true });
  await __test.initializeRuntimeDataRoot(runtimeRoot, lock, false);
  await __test.requireOwnedRuntimeDataRoot(runtimeRoot, lock);

  await assert.rejects(
    __test.requireOwnedRuntimeDataRoot(runtimeRoot, { ...lock, inputDigest: hash('wrong-run') }),
    (error) => error instanceof FullDataContractError && error.code === 'runtime_root_marker_mismatch',
  );

  await __test.cleanupRuntimeDataRoot(runtimeRoot, lock);
  await assert.rejects(lstat(runtimeRoot), (error) => error?.code === 'ENOENT');

  const resumableRoot = path.join(await realpath(parent), 'resumable-runtime');
  const cleanupEvidence = path.join(await realpath(parent), 'cleanup-evidence');
  await mkdir(cleanupEvidence, { mode: 0o700 });
  const resumableLock = {
    ...lock,
    runtimeDataRootDigest: __test.domainHash(
      'nimi.realm-v3-full-data-runtime-root/v1',
      resumableRoot,
    ),
  };
  await __test.initializeRuntimeDataRoot(resumableRoot, resumableLock, false);
  const cleanup = await __test.cleanupRuntimeDataRootResumable(
    cleanupEvidence,
    resumableRoot,
    resumableLock,
  );
  assert.equal(cleanup.status, 'PASS');
  assert.equal(cleanup.residue, 0);
  await assert.rejects(lstat(resumableRoot), (error) => error?.code === 'ENOENT');
  assert.deepEqual(
    await __test.cleanupRuntimeDataRootResumable(cleanupEvidence, resumableRoot, resumableLock),
    cleanup,
  );
});

test('runtime and evidence roots reject broad permissions and symlink traversal', async (t) => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'realm-v3-full-paths-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const nimiRoot = path.join(parent, 'nimi');
  await mkdir(nimiRoot, { mode: 0o700 });
  const wideRuntimeRoot = path.join(parent, 'wide-runtime');
  await mkdir(wideRuntimeRoot, { mode: 0o755 });
  await chmod(wideRuntimeRoot, 0o755);
  if (process.platform !== 'win32') {
    await assert.rejects(
      __test.initializeRuntimeDataRoot(wideRuntimeRoot, runLock({ final: true }), false),
      (error) => error instanceof FullDataContractError && error.code === 'unsafe_runtime_data_root',
    );
  }
  assert.throws(
    () => __test.validateRuntimeDataRoot(nimiRoot, wideRuntimeRoot, true),
    (error) => error instanceof FullDataContractError && error.code === 'unsafe_runtime_data_root',
  );
  const interruptedFreshRoot = path.join(parent, 'interrupted-fresh-runtime');
  await mkdir(interruptedFreshRoot, { mode: 0o700 });
  const interruptedLock = runLock({ final: true });
  await __test.initializePreflightRuntimeDataRoot(interruptedFreshRoot, interruptedLock, true);
  await __test.requireOwnedRuntimeDataRoot(interruptedFreshRoot, interruptedLock);
  const foreignRoot = path.join(parent, 'foreign-runtime');
  await mkdir(foreignRoot, { mode: 0o700 });
  await writeFile(path.join(foreignRoot, 'foreign-state'), 'not-owned-by-this-run');
  await assert.rejects(
    __test.initializePreflightRuntimeDataRoot(foreignRoot, interruptedLock, true),
    (error) =>
      error instanceof FullDataContractError && error.code === 'runtime_root_marker_missing',
  );
  const outside = path.join(parent, 'outside');
  await mkdir(path.join(nimiRoot, '.nimi', 'local'), { recursive: true });
  await mkdir(outside);
  await symlink(
    outside,
    path.join(nimiRoot, '.nimi', 'local', 'escape'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(
    () => __test.validateEvidenceDirectory(nimiRoot, path.join(nimiRoot, '.nimi', 'local', 'escape', 'run')),
    (error) => error instanceof FullDataContractError && error.code === 'unsafe_evidence_path',
  );
});

test('live census proves immutable persistent 470/1, selected disposable 470/1, and exact 471 identities', () => {
  const lock = runLock({ sourceMode: 'live' });
  const census = sourceCensus(lock);
  assert.equal(validateSourceCensus(census, censusIdentity(lock)), census);

  const missing = structuredClone(census);
  missing.sources.pop();
  missing.sourceCount -= 1;
  assert.throws(
    () => validateSourceCensus(missing, censusIdentity(lock)),
    (error) => error instanceof FullDataContractError && error.code === 'denominator_mismatch',
  );

  const duplicate = structuredClone(census);
  duplicate.sources[1].sourceRef = duplicate.sources[0].sourceRef;
  assert.throws(
    () => validateSourceCensus(duplicate, censusIdentity(lock)),
    (error) => error instanceof FullDataContractError && error.code === 'duplicate_partition',
  );

  const digestMismatch = structuredClone(census);
  digestMismatch.contentHash = hash('different-census');
  assert.throws(
    () => validateSourceCensus(digestMismatch, censusIdentity(lock)),
    (error) => error instanceof FullDataContractError && error.code === 'census_digest_mismatch',
  );

  const persistentPersonaResidue = structuredClone(census);
  persistentPersonaResidue.persistentPersonaCharacters = 2;
  assert.throws(
    () => validateSourceCensus(persistentPersonaResidue, censusIdentity(lock)),
    (error) => error instanceof FullDataContractError && error.code === 'live_census_mutated_persistent_state',
  );

  const falseWorldParity = structuredClone(census);
  falseWorldParity.worldParity.disposableWorldSourceSetDigest = hash('different-world-set');
  assert.throws(
    () => validateSourceCensus(falseWorldParity, censusIdentity(lock)),
    (error) => error instanceof FullDataContractError && error.code === 'live_census_mutated_persistent_state',
  );

  assert.throws(
    () => validateSourceCensus(census, {
      ...censusIdentity(lock),
      liveEnvironmentAttestationDigest: hash('different-attestation'),
    }),
    (error) => error instanceof FullDataContractError && error.code === 'identity_mismatch',
  );
});

test('dirty final candidate is content-addressed and same-path mutation blocks resume', async (t) => {
  const repository = await mkdtemp(path.join(os.tmpdir(), 'realm-v3-full-candidate-'));
  const workerDirectory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'realm-v3-full-worker-')),
  );
  t.after(() => rm(repository, { recursive: true, force: true }));
  t.after(() => rm(workerDirectory, { recursive: true, force: true }));
  const nc6Path = await createDirtyCandidateRepository(repository);
  const liveEnvironment = liveEnvironmentProjection();
  const liveEnvironmentAttestationDigest = hash('live-environment-attestation');
  const liveEnvironmentAttestationFileSha256 = hash('live-environment-attestation-file');
  const liveEnvironmentWrapperRegistrationDigest = hash('live-environment-wrapper-registration');
  const liveEnvironmentWrapperIdentityDigest = hash('live-environment-wrapper-identity');
  const liveEnvironmentCensusChildIdentityDigest = hash('live-environment-census-child');
  const liveEnvironmentPartitionChildIdentityDigest = hash('live-environment-partition-child');
  const censusExecutionReceipt = censusWrapperExecutionReceipt({
    liveEnvironmentAttestationDigest,
    liveEnvironmentWrapperIdentityDigest,
    liveEnvironmentWrapperRegistrationDigest,
    liveEnvironmentCensusChildIdentityDigest,
  });
  const workerPath = path.join(workerDirectory, 'runtimeagent-full-data.test');
  const workerChildPath = path.join(workerDirectory, 'runtimeagent-full-data-child');
  const workerScriptPath = path.join(workerDirectory, 'runtimeagent-full-data-input');
  await writeFile(workerPath, '#!/bin/sh\nexit 0\n');
  await chmod(workerPath, 0o755);
  await writeFile(workerChildPath, '#!/bin/sh\nexit 0\n');
  await chmod(workerChildPath, 0o755);
  await writeFile(workerScriptPath, 'child-v1\n');
  await chmod(workerScriptPath, 0o600);

  const firstIdentity = await __test.buildCensusExpectation(repository);
  const first = await buildRunLock({
    nimiRoot: repository,
    runtimeDataRoot: path.join(os.tmpdir(), 'realm-v3-full-data-runtime-0123456789abcdef'),
    mode: 'final',
    sourceMode: 'live',
    sourceCensus: sourceCensusForIdentity(firstIdentity, liveEnvironmentAttestationDigest),
    censusExecutionReceipt,
    liveEnvironment,
    liveEnvironmentAttestationDigest,
    liveEnvironmentAttestationFileSha256,
    liveEnvironmentWrapperRegistrationDigest,
    liveEnvironmentWrapperIdentityDigest,
    liveEnvironmentCensusChildIdentityDigest,
    liveEnvironmentPartitionChildIdentityDigest,
    upstreamEvidencePath: nc6Path,
    partitionWorker: workerPath,
    partitionWorkerArgs: ['exec', '--stage', 'partition', '--partition', '{partition}', '--execution-receipt-out', '{executionReceipt}', '--', workerChildPath, workerScriptPath, '-test.run=partition'],
    partitionWorkerChildExecutable: workerChildPath,
    partitionWorkerInputPaths: [workerScriptPath],
    censusWorker: workerPath,
    censusWorkerArgs: ['exec', '--stage', 'census', '--partition', '{partition}', '--execution-receipt-out', '{executionReceipt}', '--', workerChildPath, workerScriptPath, '-test.run=census'],
    censusWorkerChildExecutable: workerChildPath,
    censusWorkerInputPaths: [workerScriptPath],
  });
  assert.equal(first.runLock.nimi.worktreeClean, false);
  assert.equal(first.runLock.nimi.worktreeDigest, firstIdentity.nimi.worktreeDigest);

  await writeFile(workerScriptPath, 'child-v2\n');
  const transitiveDrift = await buildRunLock({
    nimiRoot: repository,
    runtimeDataRoot: path.join(os.tmpdir(), 'realm-v3-full-data-runtime-0123456789abcdef'),
    mode: 'final',
    sourceMode: 'live',
    sourceCensus: sourceCensusForIdentity(firstIdentity, liveEnvironmentAttestationDigest),
    censusExecutionReceipt,
    liveEnvironment,
    liveEnvironmentAttestationDigest,
    liveEnvironmentAttestationFileSha256,
    liveEnvironmentWrapperRegistrationDigest,
    liveEnvironmentWrapperIdentityDigest,
    liveEnvironmentCensusChildIdentityDigest,
    liveEnvironmentPartitionChildIdentityDigest,
    upstreamEvidencePath: nc6Path,
    partitionWorker: workerPath,
    partitionWorkerArgs: ['exec', '--stage', 'partition', '--partition', '{partition}', '--execution-receipt-out', '{executionReceipt}', '--', workerChildPath, workerScriptPath, '-test.run=partition'],
    partitionWorkerChildExecutable: workerChildPath,
    partitionWorkerInputPaths: [workerScriptPath],
    censusWorker: workerPath,
    censusWorkerArgs: ['exec', '--stage', 'census', '--partition', '{partition}', '--execution-receipt-out', '{executionReceipt}', '--', workerChildPath, workerScriptPath, '-test.run=census'],
    censusWorkerChildExecutable: workerChildPath,
    censusWorkerInputPaths: [workerScriptPath],
  });
  assert.equal(
    transitiveDrift.runLock.workers.partition.executableSha256,
    first.runLock.workers.partition.executableSha256,
  );
  assert.notEqual(
    transitiveDrift.runLock.workers.partition.inputFiles[0].sha256,
    first.runLock.workers.partition.inputFiles[0].sha256,
  );
  assert.throws(
    () => validateFrozenRunLock(transitiveDrift.runLock, first.runLock),
    (error) => error instanceof FullDataContractError && error.code === 'resume_digest_mismatch',
  );

  await writeFile(workerPath, '#!/bin/sh\nexit 1\n');
  const workerDrift = await buildRunLock({
    nimiRoot: repository,
    runtimeDataRoot: path.join(os.tmpdir(), 'realm-v3-full-data-runtime-0123456789abcdef'),
    mode: 'final',
    sourceMode: 'live',
    sourceCensus: sourceCensusForIdentity(firstIdentity, liveEnvironmentAttestationDigest),
    censusExecutionReceipt,
    liveEnvironment,
    liveEnvironmentAttestationDigest,
    liveEnvironmentAttestationFileSha256,
    liveEnvironmentWrapperRegistrationDigest,
    liveEnvironmentWrapperIdentityDigest,
    liveEnvironmentCensusChildIdentityDigest,
    liveEnvironmentPartitionChildIdentityDigest,
    upstreamEvidencePath: nc6Path,
    partitionWorker: workerPath,
    partitionWorkerArgs: ['exec', '--stage', 'partition', '--partition', '{partition}', '--execution-receipt-out', '{executionReceipt}', '--', workerChildPath, workerScriptPath, '-test.run=partition'],
    partitionWorkerChildExecutable: workerChildPath,
    partitionWorkerInputPaths: [workerScriptPath],
    censusWorker: workerPath,
    censusWorkerArgs: ['exec', '--stage', 'census', '--partition', '{partition}', '--execution-receipt-out', '{executionReceipt}', '--', workerChildPath, workerScriptPath, '-test.run=census'],
    censusWorkerChildExecutable: workerChildPath,
    censusWorkerInputPaths: [workerScriptPath],
  });
  assert.equal(workerDrift.runLock.nimi.worktreeDigest, first.runLock.nimi.worktreeDigest);
  assert.notEqual(
    workerDrift.runLock.workers.partition.executableSha256,
    first.runLock.workers.partition.executableSha256,
  );
  assert.throws(
    () => validateFrozenRunLock(workerDrift.runLock, first.runLock),
    (error) => error instanceof FullDataContractError && error.code === 'resume_digest_mismatch',
  );

  await writeRepositoryFile(
    repository,
    'scripts/lib/realm-v3-full-data-runner.mjs',
    'export const runner = 3;\n',
  );
  const secondIdentity = await __test.buildCensusExpectation(repository);
  const second = await buildRunLock({
    nimiRoot: repository,
    runtimeDataRoot: path.join(os.tmpdir(), 'realm-v3-full-data-runtime-0123456789abcdef'),
    mode: 'final',
    sourceMode: 'live',
    sourceCensus: sourceCensusForIdentity(secondIdentity, liveEnvironmentAttestationDigest),
    censusExecutionReceipt,
    liveEnvironment,
    liveEnvironmentAttestationDigest,
    liveEnvironmentAttestationFileSha256,
    liveEnvironmentWrapperRegistrationDigest,
    liveEnvironmentWrapperIdentityDigest,
    liveEnvironmentCensusChildIdentityDigest,
    liveEnvironmentPartitionChildIdentityDigest,
    upstreamEvidencePath: nc6Path,
    partitionWorker: workerPath,
    partitionWorkerArgs: ['exec', '--stage', 'partition', '--partition', '{partition}', '--execution-receipt-out', '{executionReceipt}', '--', workerChildPath, workerScriptPath, '-test.run=partition'],
    partitionWorkerChildExecutable: workerChildPath,
    partitionWorkerInputPaths: [workerScriptPath],
    censusWorker: workerPath,
    censusWorkerArgs: ['exec', '--stage', 'census', '--partition', '{partition}', '--execution-receipt-out', '{executionReceipt}', '--', workerChildPath, workerScriptPath, '-test.run=census'],
    censusWorkerChildExecutable: workerChildPath,
    censusWorkerInputPaths: [workerScriptPath],
  });
  assert.notEqual(second.runLock.nimi.consumerContractDigest, workerDrift.runLock.nimi.consumerContractDigest);
  assert.notEqual(second.runLock.nimi.worktreeDigest, workerDrift.runLock.nimi.worktreeDigest);
  assert.throws(
    () => validateFrozenRunLock(second.runLock, workerDrift.runLock),
    (error) => error instanceof FullDataContractError && error.code === 'resume_digest_mismatch',
  );
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  computeCandidateBindingSha256,
  computeExecutionSetId,
  loadAcceptanceSchema,
  validateLiveDevKernelCandidateBindings,
  validateDevKernelCheckpointManifest,
} from './check-dev-kernel-checkpoint-acceptance.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const gate = path.join(scriptDir, 'check-dev-kernel-checkpoint-acceptance.mjs');
const fixtureSource = path.join(scriptDir, 'testdata/dev-kernel-checkpoint-acceptance');
const positiveSource = path.join(fixtureSource, 'positive.yaml');
const negativeSource = path.join(fixtureSource, 'negative-mutations.yaml');
const localAgentEvidenceId = 'synthetic-local-agent-journey';

const exactRequiredRows = [
  'A-01', 'A-03', 'A-04', 'A-05', 'A-06', 'A-09',
  'C-03', 'C-04', 'C-06', 'C-08', 'C-09',
  'D-01', 'D-02', 'D-03', 'D-04', 'D-05', 'D-06', 'D-08', 'D-09',
  'E-01a', 'E-03', 'E-04a', 'E-05', 'E-07', 'E-08', 'E-09',
  'F-01', 'F-02', 'F-03a', 'F-04a', 'F-06a',
  'H-01', 'H-02', 'H-03', 'H-04', 'H-05',
];

const schema = await loadAcceptanceSchema();
const mutationPacket = parseYaml(await fs.readFile(negativeSource, 'utf8'));

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function getAt(root, pathSegments) {
  return pathSegments.reduce((value, segment) => value?.[segment], root);
}

function parentAt(root, pathSegments) {
  assert.ok(pathSegments.length > 0, 'mutation path must not be empty');
  return [getAt(root, pathSegments.slice(0, -1)), pathSegments.at(-1)];
}

function applyObjectMutation(root, mutation) {
  switch (mutation.operation) {
    case 'set_manifest':
    case 'set': {
      const [parent, key] = parentAt(root, mutation.path);
      assert.ok(parent !== undefined && parent !== null, `missing mutation parent ${mutation.path.join('.')}`);
      parent[key] = structuredClone(mutation.value);
      return;
    }
    case 'remove_array_item': {
      const target = getAt(root, mutation.path);
      assert.ok(Array.isArray(target), `remove target is not an array: ${mutation.path.join('.')}`);
      const index = target.findIndex((item) => item?.[mutation.matchField] === mutation.matchValue);
      assert.notEqual(index, -1, `missing mutation item ${mutation.matchField}=${mutation.matchValue}`);
      target.splice(index, 1);
      return;
    }
    case 'set_matching': {
      const target = getAt(root, mutation.path);
      assert.ok(Array.isArray(target), `matching target is not an array: ${mutation.path.join('.')}`);
      const item = target.find((candidate) => candidate?.[mutation.matchField] === mutation.matchValue);
      assert.ok(item, `missing matching mutation item ${mutation.matchField}=${mutation.matchValue}`);
      item[mutation.field] = structuredClone(mutation.value);
      return;
    }
    default:
      throw new Error(`unsupported object mutation ${mutation.operation}`);
  }
}

async function makeFixtureBundle() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-kernel-checkpoint-contract-'));
  const bundleRoot = path.join(tempRoot, 'bundle');
  await fs.cp(fixtureSource, bundleRoot, { recursive: true });
  return {
    tempRoot,
    bundleRoot,
    manifestPath: path.join(bundleRoot, 'positive.yaml'),
    executionObservationPath: path.join(bundleRoot, 'synthetic-execution-observation.json'),
    runnerResultPath: path.join(bundleRoot, 'runner/result.json'),
    runnerManifestPath: path.join(bundleRoot, 'runner/artifact-manifest.json'),
  };
}

function evidenceEntry(manifest, evidenceId) {
  const entry = manifest.evidence.find((candidate) => candidate.evidenceId === evidenceId);
  assert.ok(entry, `missing evidence entry ${evidenceId}`);
  return entry;
}

async function readEvidenceRecord(bundle, manifest, evidenceId) {
  const entry = evidenceEntry(manifest, evidenceId);
  const recordPath = path.join(bundle.bundleRoot, ...entry.ref.split('/'));
  return { entry, recordPath, record: JSON.parse(await fs.readFile(recordPath, 'utf8')) };
}

async function writeEvidenceRecord(bundle, manifest, evidenceId, record) {
  const entry = evidenceEntry(manifest, evidenceId);
  const recordPath = path.join(bundle.bundleRoot, ...entry.ref.split('/'));
  const content = `${JSON.stringify(record, null, 2)}\n`;
  await fs.writeFile(recordPath, content, 'utf8');
  entry.sha256 = digest(content);
}

async function writeJson(target, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(target, content, 'utf8');
  return { sha256: digest(content), bytes: Buffer.byteLength(content) };
}

async function refreshSharedArtifactRefs(bundle, manifest, artifactRef, artifactSha256) {
  for (const entry of manifest.evidence) {
    const { record } = await readEvidenceRecord(bundle, manifest, entry.evidenceId);
    let changed = false;
    for (const artifact of record.artifactRefs) {
      if (artifact.ref === artifactRef) {
        artifact.sha256 = artifactSha256;
        changed = true;
      }
    }
    if (changed) await writeEvidenceRecord(bundle, manifest, entry.evidenceId, record);
  }
}

async function refreshRunnerArtifactRefs(bundle, manifest) {
  const filesByRole = new Map([
    ['runner_result', bundle.runnerResultPath],
    ['runner_artifact_manifest', bundle.runnerManifestPath],
  ]);
  for (const entry of manifest.evidence) {
    const { record } = await readEvidenceRecord(bundle, manifest, entry.evidenceId);
    let changed = false;
    for (const artifact of record.artifactRefs) {
      const file = filesByRole.get(artifact.role);
      if (file) {
        artifact.sha256 = digest(await fs.readFile(file));
        changed = true;
      }
    }
    if (changed) await writeEvidenceRecord(bundle, manifest, entry.evidenceId, record);
  }
}

async function writeRunnerBundle(bundle, manifest, result, runnerManifest) {
  const resultFile = await writeJson(bundle.runnerResultPath, result);
  const resultEntry = runnerManifest.files.find((file) => file.path.replace(/\\/gu, '/') === 'result.json');
  if (resultEntry) {
    resultEntry.sha256 = resultFile.sha256;
    resultEntry.bytes = resultFile.bytes;
  }
  await writeJson(bundle.runnerManifestPath, runnerManifest);
  await refreshRunnerArtifactRefs(bundle, manifest);
}

async function mutateRunnerResult(bundle, manifest, mutate) {
  const result = JSON.parse(await fs.readFile(bundle.runnerResultPath, 'utf8'));
  const runnerManifest = JSON.parse(await fs.readFile(bundle.runnerManifestPath, 'utf8'));
  mutate(result, runnerManifest);
  await writeRunnerBundle(bundle, manifest, result, runnerManifest);
}

async function mutateRunnerManifest(bundle, manifest, mutate) {
  const runnerManifest = JSON.parse(await fs.readFile(bundle.runnerManifestPath, 'utf8'));
  mutate(runnerManifest);
  await writeJson(bundle.runnerManifestPath, runnerManifest);
  await refreshRunnerArtifactRefs(bundle, manifest);
}

async function rebindCandidate(bundle, manifest) {
  const candidateBinding = computeCandidateBindingSha256(manifest);
  manifest.candidateBindingSha256 = candidateBinding;
  const executionRecord = (await readEvidenceRecord(bundle, manifest, 'synthetic-runtime-trace')).record;
  const { journeyTrialId, sourceStateDigest } = executionRecord.executionBinding;
  const executionSetId = computeExecutionSetId(candidateBinding, journeyTrialId, sourceStateDigest);
  const observation = JSON.parse(await fs.readFile(bundle.executionObservationPath, 'utf8'));
  observation.executionSetId = executionSetId;
  observation.journeyTrialId = journeyTrialId;
  observation.sourceStateDigest = sourceStateDigest;
  const observationFile = await writeJson(bundle.executionObservationPath, observation);
  for (const entry of manifest.evidence) {
    const { record } = await readEvidenceRecord(bundle, manifest, entry.evidenceId);
    entry.candidateBindingSha256 = candidateBinding;
    record.candidateBindingSha256 = candidateBinding;
    if (record.executionBinding) record.executionBinding.executionSetId = executionSetId;
    for (const artifact of record.artifactRefs) {
      if (artifact.role === 'execution_observation') artifact.sha256 = observationFile.sha256;
    }
    await writeEvidenceRecord(bundle, manifest, entry.evidenceId, record);
  }
}

async function applyFixtureMutation(bundle, manifest, fixture) {
  const mutation = fixture.mutation;
  switch (mutation.operation) {
    case 'set_manifest':
    case 'remove_array_item':
    case 'set_matching':
      applyObjectMutation(manifest, mutation);
      break;
    case 'set_evidence_kind': {
      const { entry, record } = await readEvidenceRecord(bundle, manifest, mutation.evidenceId);
      entry.kind = mutation.value;
      record.evidenceKind = mutation.value;
      await writeEvidenceRecord(bundle, manifest, mutation.evidenceId, record);
      break;
    }
    case 'replace_claims_all_rows': {
      const { record } = await readEvidenceRecord(bundle, manifest, mutation.evidenceId);
      const policies = schema.repository_static_close_manifest.dev_kernel_checkpoint.row_evidence_policy;
      record.claims = exactRequiredRows.map((rowId) => ({
        rowId,
        claimId: policies[rowId].required_claims[0].claim_id,
      }));
      await writeEvidenceRecord(bundle, manifest, mutation.evidenceId, record);
      break;
    }
    case 'remove_evidence_claim': {
      const { record } = await readEvidenceRecord(bundle, manifest, mutation.evidenceId);
      record.claims = record.claims.filter((claim) => claim.rowId !== mutation.rowId || claim.claimId !== mutation.claimId);
      await writeEvidenceRecord(bundle, manifest, mutation.evidenceId, record);
      break;
    }
    case 'set_evidence_record': {
      const { record } = await readEvidenceRecord(bundle, manifest, mutation.evidenceId);
      applyObjectMutation(record, { ...mutation, operation: 'set' });
      await writeEvidenceRecord(bundle, manifest, mutation.evidenceId, record);
      break;
    }
    case 'copy_execution_binding': {
      const source = (await readEvidenceRecord(bundle, manifest, mutation.fromEvidenceId)).record;
      const target = (await readEvidenceRecord(bundle, manifest, mutation.toEvidenceId)).record;
      target.executionBinding = structuredClone(source.executionBinding);
      await writeEvidenceRecord(bundle, manifest, mutation.toEvidenceId, target);
      break;
    }
    case 'remove_artifact_role': {
      const { record } = await readEvidenceRecord(bundle, manifest, mutation.evidenceId);
      record.artifactRefs = record.artifactRefs.filter((artifact) => artifact.role !== mutation.role);
      await writeEvidenceRecord(bundle, manifest, mutation.evidenceId, record);
      break;
    }
    case 'diverge_execution_binding': {
      const { record } = await readEvidenceRecord(bundle, manifest, mutation.evidenceId);
      record.executionBinding.sourceStateDigest = mutation.sourceStateDigest;
      record.executionBinding.executionSetId = computeExecutionSetId(
        manifest.candidateBindingSha256,
        record.executionBinding.journeyTrialId,
        record.executionBinding.sourceStateDigest,
      );
      await writeEvidenceRecord(bundle, manifest, mutation.evidenceId, record);
      break;
    }
    case 'set_execution_observation': {
      const observation = JSON.parse(await fs.readFile(bundle.executionObservationPath, 'utf8'));
      applyObjectMutation(observation, { ...mutation, operation: 'set' });
      const output = await writeJson(bundle.executionObservationPath, observation);
      await refreshSharedArtifactRefs(bundle, manifest, 'synthetic-execution-observation.json', output.sha256);
      break;
    }
    case 'set_runner_result':
      await mutateRunnerResult(bundle, manifest, (result) => applyObjectMutation(result, { ...mutation, operation: 'set' }));
      break;
    case 'set_runner_manifest':
      await mutateRunnerManifest(bundle, manifest, (runnerManifest) => applyObjectMutation(runnerManifest, { ...mutation, operation: 'set' }));
      break;
    case 'set_runner_checkpoint':
      await mutateRunnerResult(bundle, manifest, (result) => {
        const checkpoint = result.checkpoints.find((item) => item.checkpointId === mutation.checkpointId);
        assert.ok(checkpoint, `missing checkpoint ${mutation.checkpointId}`);
        checkpoint[mutation.field] = structuredClone(mutation.value);
      });
      break;
    case 'remove_runner_checkpoint':
      await mutateRunnerResult(bundle, manifest, (result) => {
        result.checkpoints = result.checkpoints.filter((item) => item.checkpointId !== mutation.checkpointId);
      });
      break;
    case 'remove_runner_artifact':
      await mutateRunnerResult(bundle, manifest, (result, runnerManifest) => {
        const artifact = result.artifacts.find((item) => item.artifactId === mutation.artifactId);
        assert.ok(artifact, `missing runner artifact ${mutation.artifactId}`);
        result.artifacts = result.artifacts.filter((item) => item.artifactId !== mutation.artifactId);
        const normalizedArtifactPath = artifact.path.replace(/\\/gu, '/');
        runnerManifest.files = runnerManifest.files.filter((file) => !normalizedArtifactPath.endsWith(file.path.replace(/\\/gu, '/')));
      });
      break;
    case 'remove_runner_manifest_file':
      await mutateRunnerManifest(bundle, manifest, (runnerManifest) => {
        runnerManifest.files = runnerManifest.files.filter((file) => file.path.replace(/\\/gu, '/') !== mutation.path);
      });
      break;
    case 'replace_file_without_rehash':
      await fs.writeFile(path.join(bundle.bundleRoot, ...mutation.ref.split('/')), mutation.value, 'utf8');
      break;
    case 'replace_shared_artifact': {
      const target = path.join(bundle.bundleRoot, ...mutation.ref.split('/'));
      await fs.writeFile(target, mutation.value, 'utf8');
      await refreshSharedArtifactRefs(bundle, manifest, mutation.ref, digest(mutation.value));
      break;
    }
    case 'set_evidence_entry': {
      const entry = evidenceEntry(manifest, mutation.evidenceId);
      applyObjectMutation(entry, { ...mutation, operation: 'set' });
      break;
    }
    default:
      throw new Error(`unsupported fixture mutation ${mutation.operation}`);
  }
  if (fixture.rebindCandidate === true) await rebindCandidate(bundle, manifest);
  await fs.writeFile(bundle.manifestPath, stringifyYaml(manifest, { lineWidth: 0 }), 'utf8');
}

test('row-specific synthetic contract fixture validates through the explicit CLI', () => {
  const result = spawnSync(process.execPath, [gate, '--fixture-mode', '--manifest', positiveSource], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /fixture: OK \(36 required rows, non-admissible candidate [0-9a-f]{64}\)/u);
});

test('synthetic positive fixture is rejected by the admissible checker path', () => {
  const result = spawnSync(process.execPath, [gate, '--manifest', positiveSource], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, /SYNTHETIC_FIXTURE_NOT_ADMISSIBLE/u);
});

test('package-facing checker cannot pass without an explicit manifest', () => {
  const result = spawnSync(process.execPath, [gate], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, /CLI_USAGE_INVALID/u);
});

test('acceptance contract preserves close posture and defines exact row evidence semantics', async () => {
  assert.equal(schema.id, 'nimi-coding.acceptance.v1');
  assert.equal(schema.kind, 'acceptance');
  assert.deepEqual(schema.required_blocks, ['Findings', 'Authority Alignment', 'Evidence Sufficiency', 'Disposition']);
  const contract = schema.repository_static_close_manifest;
  assert.deepEqual(
    Object.fromEntries(Object.entries(contract.close_level_profiles).map(([level, value]) => [level, value.category])),
    {
      dev_kernel_checkpoint: 'checkpoint',
      windows_platform_reference_close: 'platform',
      app_migration_close: 'app',
      ecosystem_hardcut_close: 'ecosystem',
    },
  );
  const checkpoint = contract.dev_kernel_checkpoint;
  assert.deepEqual(checkpoint.exact_required_rows, exactRequiredRows);
  assert.deepEqual(Object.keys(checkpoint.row_evidence_policy), exactRequiredRows);
  assert.ok(Object.values(checkpoint.row_evidence_policy).every((policy) => policy.required_claims.length > 0));
  assert.ok(!checkpoint.evidence_record.evidence_kind_enum.includes('closeout'));
  assert.deepEqual(checkpoint.row_evidence_policy['F-04a'].required_claims, [{
    claim_id: 'journey.dev_kernel_core_real_shell_passed',
    allowed_evidence_kinds: ['local_agent_journey'],
    execution_binding: 'required',
    runner_profile: 'dev_kernel_core_v2',
  }]);
  const runnerBackedClaims = Object.values(checkpoint.row_evidence_policy)
    .flatMap((policy) => policy.required_claims)
    .filter((claim) => claim.runner_profile === 'dev_kernel_core_v2');
  assert.ok(runnerBackedClaims.length > 1, 'real journey rows beyond F-04a must bind the v2 runner profile');
  assert.ok(runnerBackedClaims.every((claim) => claim.execution_binding === 'required'));
  assert.equal(checkpoint.runner_profiles.dev_kernel_core_v2.exact_required_checkpoints.length, 22);
  assert.equal(checkpoint.runner_profiles.dev_kernel_core_v2.minimum_shell_screenshot_artifacts, 2);
});

test('positive fixture uses explicit claims and more than one evidence kind', async () => {
  const manifest = parseYaml(await fs.readFile(positiveSource, 'utf8'));
  assert.ok(manifest.evidence.length > 1);
  assert.ok(new Set(manifest.evidence.map((entry) => entry.kind)).size > 1);
  assert.ok(manifest.acceptanceRows.some((row) => row.evidenceRefs.length > 1));
  assert.ok(manifest.acceptanceRows.every((row) => row.evidenceRefs.length < manifest.evidence.length));
});

test('candidate binding canonicalization is independent of YAML/object key order', async () => {
  const manifest = parseYaml(await fs.readFile(positiveSource, 'utf8'));
  manifest.candidate = Object.fromEntries(Object.entries(manifest.candidate).reverse());
  manifest.candidate.runtime = Object.fromEntries(Object.entries(manifest.candidate.runtime).reverse());
  assert.equal(computeCandidateBindingSha256(manifest), manifest.candidateBindingSha256);
  assert.deepEqual(await validateDevKernelCheckpointManifest(manifest, positiveSource, null, { allowSyntheticFixture: true }), []);
});

test('admissible live binding rejects source-tree drift after the Runtime candidate was built', async () => {
  const manifest = parseYaml(await fs.readFile(positiveSource, 'utf8'));
  const runtimeCandidateId = `dev-kernel-runtime-${'1'.repeat(32)}`;
  manifest.candidate.candidateId = runtimeCandidateId;
  manifest.candidate.runtime.buildId = runtimeCandidateId;
  manifest.candidate.builds.find((item) => item.component === 'runtime').buildId = runtimeCandidateId;
  const repository = manifest.candidate.repositories.find((item) => item.repoId === 'nimi');
  const source = {
    repositoryId: 'nimi',
    headCommit: repository.headCommit,
    branch: 'refactory/third-party',
    dirty: repository.dirty,
    trackedDiffSha256: repository.dirtyDiffSha256,
    untrackedFiles: [],
    sourceTreeSha256: '2'.repeat(64),
    dirtyDescriptorSha256: '3'.repeat(64),
  };
  const buildRecord = {
    candidateId: runtimeCandidateId,
    source: structuredClone(source),
    runtime: {
      binarySha256: manifest.candidate.runtime.binarySha256,
      signerCertificateSha256: manifest.developmentServiceSignature.certificateFingerprintSha256,
    },
  };
  assert.deepEqual(validateLiveDevKernelCandidateBindings(manifest, {
    source,
    buildRecord,
    runtimeBinarySha256: manifest.candidate.runtime.binarySha256,
  }), []);

  const driftedSource = { ...source, sourceTreeSha256: '4'.repeat(64) };
  const issues = validateLiveDevKernelCandidateBindings(manifest, {
    source: driftedSource,
    buildRecord,
    runtimeBinarySha256: manifest.candidate.runtime.binarySha256,
  });
  assert.ok(issues.some((item) => item.code === 'LIVE_SOURCE_STATE_MISMATCH'));
});

for (const fixture of mutationPacket.fixtures) {
  test(`rejects independent negative mutation: ${fixture.fixtureId}`, async () => {
    const bundle = await makeFixtureBundle();
    try {
      const manifest = parseYaml(await fs.readFile(bundle.manifestPath, 'utf8'));
      await applyFixtureMutation(bundle, manifest, fixture);
      const issues = await validateDevKernelCheckpointManifest(manifest, bundle.manifestPath, null, { allowSyntheticFixture: true });
      assert.ok(
        issues.some((item) => item.code === fixture.expectedCode),
        `${fixture.fixtureId} expected ${fixture.expectedCode}, got ${JSON.stringify(issues, null, 2)}`,
      );
    } finally {
      await fs.rm(bundle.tempRoot, { recursive: true, force: true });
    }
  });
}

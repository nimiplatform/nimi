import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readLocalAgentTestArchitecture } from './registry.mjs';
import { validateArchitecture, validateJourneyRepeatIsolation, validateJourneyResult } from './validation.mjs';

const clone = (value) => structuredClone(value);

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function expectFailure(failures, pattern) {
  assert.ok(failures.some((failure) => pattern.test(failure)), `expected ${pattern}, got ${JSON.stringify(failures)}`);
}

function validArchitecture() {
  const architecture = readLocalAgentTestArchitecture();
  assert.deepEqual(validateArchitecture(architecture), []);
  return architecture;
}

function sourceState() {
  return {
    schemaVersion: 'nimi.local-agent-product-source-state/v2',
    nimiCommit: 'a'.repeat(40),
    realmCommit: 'b'.repeat(40),
    nimiSourceTreeSha256: 'c'.repeat(64),
    realmSourceTreeSha256: 'd'.repeat(64),
    acceptanceCatalogSha256: 'e'.repeat(64),
    journeyRegistrySha256: 'f'.repeat(64),
    executionPolicySha256: '1'.repeat(64),
    sourceDigest: '2'.repeat(64),
  };
}

function createValidJourneyFixture() {
  const architecture = validArchitecture();
  const journey = architecture.journeys.journeys.find((row) => row.journey_id === 'full-chain-core');
  const points = architecture.catalog.acceptance_points.filter((point) => point.execution_binding?.journey_id === journey.journey_id);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-journey-validation-'));
  const safePath = path.join(root, 'safe-evidence.json');
  const providerPath = path.join(root, 'provider-capture-summary.json');
  fs.writeFileSync(safePath, '{"safe":true}\n');
  fs.writeFileSync(providerPath, `${JSON.stringify({
    complete: true,
    contextLaneOrderVerified: true,
    contextLaneIds: [
      'runtime_policy', 'output_contract', 'source_identity', 'source_behavior', 'world_context',
      'relationship_context', 'source_knowledge', 'canonical_memory', 'conversation_history', 'capability_context',
    ],
  })}\n`);
  const trialId = 'full-chain-core:L2:core:1';
  const started = Date.parse('2026-07-12T00:00:00.000Z');
  const checkpointIndex = new Map(journey.checkpoints.map((checkpoint, index) => [checkpoint.checkpoint_id, index]));
  const assertionsByCheckpoint = new Map(journey.checkpoints.map((checkpoint) => [checkpoint.checkpoint_id, []]));
  for (const point of points) {
    const target = point.execution_binding.checkpoint_ids[0];
    assertionsByCheckpoint.get(target).push(...point.assertion_ids.map((assertionId) => ({ assertionId, outcome: 'passed' })));
  }
  const checkpoints = journey.checkpoints.map((checkpoint, index) => ({
    checkpointId: checkpoint.checkpoint_id,
    prerequisiteIds: checkpoint.prerequisite_ids,
    startedAt: new Date(started + index * 10).toISOString(),
    completedAt: new Date(started + index * 10 + 5).toISOString(),
    correlations: { runtimeInstanceId: 'runtime-1', sourceRefs: [], localAgentRefs: [], turnIds: [] },
    assertions: assertionsByCheckpoint.get(checkpoint.checkpoint_id),
    artifactRefs: ['safe-evidence'],
    outcome: 'passed',
  }));
  const result = {
    schemaVersion: 'nimi.local-agent-product-journey-result/v2',
    journeyTrialId: trialId,
    journeyId: journey.journey_id,
    tier: 'L2',
    batch: 'core',
    repeatIndex: 1,
    sourceState: sourceState(),
    environmentIdentity: {
      rootId: 'isolated-root-1',
      accountIds: ['account-1'],
      worldIds: ['world-1'],
      sourceIds: ['source-1'],
      runtimeSourceRefs: ['runtime-source-1'],
      localAgentIds: ['agent-1'],
      processStarts: journey.environment.start_limits,
    },
    durationMs: 1000,
    checkpoints,
    leafResults: points.map((point) => ({
      leafId: point.leaf_id,
      journeyTrialId: trialId,
      checkpointIds: point.execution_binding.checkpoint_ids,
      assertionIds: point.assertion_ids,
      evidenceRefs: ['safe-evidence'],
      outcome: 'passed',
      failureClass: null,
    })),
    artifacts: [{ artifactId: 'safe-evidence', path: safePath, sha256: sha256(safePath), bytes: fs.statSync(safePath).size, privacyClass: 'safe_evidence' }, { artifactId: 'provider-capture-summary', path: providerPath, sha256: sha256(providerPath), bytes: fs.statSync(providerPath).size, privacyClass: 'safe_evidence' }],
    processProblems: [],
    privacy: { ok: true, findings: [] },
    outcome: 'passed',
  };
  assert.deepEqual(validateJourneyResult({ architecture, journey, result, expectedSourceState: sourceState() }), []);
  return { architecture, journey, result, root, checkpointIndex };
}

test('architecture rejects a deleted leaf mapping', () => {
  const architecture = validArchitecture();
  const mutated = clone(architecture);
  const journey = mutated.journeys.journeys.find((row) => row.journey_id === 'full-chain-core');
  const point = mutated.catalog.acceptance_points.find((row) => row.execution_binding?.journey_id === journey.journey_id);
  for (const checkpoint of journey.checkpoints) checkpoint.covered_leaf_ids = checkpoint.covered_leaf_ids.filter((id) => id !== point.leaf_id);
  expectFailure(validateArchitecture(mutated), /mapping|covered/i);
});

test('architecture rejects a nonexistent checkpoint', () => {
  const mutated = clone(validArchitecture());
  const point = mutated.catalog.acceptance_points.find((row) => row.minimum_sufficient_layer === 'L2');
  point.execution_binding.checkpoint_ids = ['checkpoint-does-not-exist'];
  expectFailure(validateArchitecture(mutated), /checkpoint-does-not-exist/);
});

test('architecture rejects duplicate or conflicting leaf owners', () => {
  const mutated = clone(validArchitecture());
  mutated.catalog.acceptance_points.push({ ...mutated.catalog.acceptance_points[0], owner_iteration: 'I8' });
  expectFailure(validateArchitecture(mutated), /duplicate|owner/i);
});

test('result rejects prerequisite failure followed by a forged downstream pass', () => {
  const fixture = createValidJourneyFixture();
  try {
    fixture.result.checkpoints[0].outcome = 'failed';
    expectFailure(validateJourneyResult({ architecture: fixture.architecture, journey: fixture.journey, result: fixture.result, expectedSourceState: sourceState() }), /prerequisite|downstream/i);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('result rejects artifact hash drift', () => {
  const fixture = createValidJourneyFixture();
  try {
    fixture.result.artifacts[0].sha256 = '0'.repeat(64);
    expectFailure(validateJourneyResult({ architecture: fixture.architecture, journey: fixture.journey, result: fixture.result, expectedSourceState: sourceState() }), /artifact hash/i);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('result rejects source digest drift', () => {
  const fixture = createValidJourneyFixture();
  try {
    fixture.result.sourceState.sourceDigest = '0'.repeat(64);
    expectFailure(validateJourneyResult({ architecture: fixture.architecture, journey: fixture.journey, result: fixture.result, expectedSourceState: sourceState() }), /source state|source digest/i);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('result rejects privacy findings', () => {
  const fixture = createValidJourneyFixture();
  try {
    fixture.result.privacy = { ok: false, findings: ['token'] };
    expectFailure(validateJourneyResult({ architecture: fixture.architecture, journey: fixture.journey, result: fixture.result, expectedSourceState: sourceState() }), /privacy/i);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('result rejects a tier budget overrun', () => {
  const fixture = createValidJourneyFixture();
  try {
    fixture.result.durationMs = fixture.journey.time_budget_ms + 1;
    expectFailure(validateJourneyResult({ architecture: fixture.architecture, journey: fixture.journey, result: fixture.result, expectedSourceState: sourceState() }), /budget|duration/i);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('result rejects a leaf mapped without evidence', () => {
  const fixture = createValidJourneyFixture();
  try {
    fixture.result.leafResults[0].evidenceRefs = [];
    expectFailure(validateJourneyResult({ architecture: fixture.architecture, journey: fixture.journey, result: fixture.result, expectedSourceState: sourceState() }), /evidence/i);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test('architecture rejects the old leaf runner becoming required again', () => {
  const mutated = clone(validArchitecture());
  mutated.policy.active_required_runner = 'tests/local-agent-product/harness/run-tier.mjs';
  expectFailure(validateArchitecture(mutated), /leaf|run-tier|active runner/i);
});

test('gate rejects logical account, world, source, and agent identity reuse across Journey repeats', () => {
  const fixture = createValidJourneyFixture();
  try {
    const second = clone(fixture.result);
    second.journeyTrialId = 'full-chain-core:L2:core-stability:2';
    second.repeatIndex = 2;
    second.environmentIdentity.rootId = 'isolated-root-2';
    expectFailure(validateJourneyRepeatIsolation([fixture.result, second]), /reused logical environment identity/i);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { terminateProcessTree } from './cross-app-driver.mjs';
import { parseP4Manifest } from './p4-manifest.mjs';
import { executeP4WorkerGate } from './p4-worker-supervisor.mjs';

const selectedIds = ['journey-a', 'journey-b', 'journey-c'];
const registryEntries = [
  { journey_id: 'journey-a', driver_gate: 'first-run', product_gate: 'gate_0', time_budget_ms: 1000 },
  { journey_id: 'journey-b', driver_gate: 'direct-nimi', product_gate: 'gate_1', time_budget_ms: 2000 },
  { journey_id: 'journey-c', driver_gate: 'partner-core', product_gate: 'gate_2', time_budget_ms: 3000 },
];

function policy(journeys = selectedIds) {
  return { gates: { first_party_p4: { journeys } } };
}

function registry(journeys = registryEntries) {
  return { journeys };
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processExists(pid);
}

test('P4 manifest parser preserves policy order and only uses an explicit startup budget override', () => {
  const fromManifest = parseP4Manifest(policy(), registry(), {});
  assert.deepEqual(fromManifest.map((entry) => entry.gate), ['first-run', 'direct-nimi', 'partner-core']);
  assert.deepEqual(fromManifest.map((entry) => entry.effectiveBudgetMs), [1000, 2000, 3000]);
  assert.ok(fromManifest.every((entry) => entry.budgetSource === 'manifest'));

  const fromEnvironment = parseP4Manifest(policy(), registry(), {
    NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_TIME_BUDGET_MS: '750',
  });
  assert.ok(fromEnvironment.every((entry) => entry.effectiveBudgetMs === 750));
  assert.ok(fromEnvironment.every((entry) => entry.budgetSource === 'environment'));
});

test('P4 manifest parser rejects duplicate IDs, duplicate drivers, unsupported drivers, and invalid budgets', () => {
  assert.throws(() => parseP4Manifest(policy(['journey-a', 'journey-a']), registry(), {}), /duplicate journey ID/u);
  assert.throws(() => parseP4Manifest(policy(), registry([...registryEntries, registryEntries[0]]), {}), /registry contains duplicate/u);
  assert.throws(() => parseP4Manifest(policy(['journey-a', 'journey-d']), registry([
    ...registryEntries,
    { journey_id: 'journey-d', driver_gate: 'first-run', time_budget_ms: 1 },
  ]), {}), /duplicate driver_gate/u);
  assert.throws(() => parseP4Manifest(policy(['journey-x']), registry([
    { journey_id: 'journey-x', driver_gate: 'other', time_budget_ms: 1 },
  ]), {}), /unsupported P4 driver_gate/u);
  assert.throws(() => parseP4Manifest(policy(['journey-x']), registry([
    { journey_id: 'journey-x', driver_gate: 'first-run', time_budget_ms: 0 },
  ]), {}), /positive safe integer/u);
  assert.throws(() => parseP4Manifest(policy(), registry(), {
    NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_TIME_BUDGET_MS: '',
  }), /positive safe integer/u);
});

test('P4 supervisor enforces a 750ms deadline, kills the worker tree, and preserves durable state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-p4-supervisor-test-'));
  const outputDir = path.join(root, 'evidence');
  const productRoot = path.join(root, 'product');
  fs.mkdirSync(productRoot);
  const durableSentinel = path.join(productRoot, 'durable-sentinel.txt');
  fs.writeFileSync(durableSentinel, 'preserve-me\n', 'utf8');
  const workerPath = path.join(import.meta.dirname, 'fixtures', 'p4-ready-hang-worker.mjs');
  try {
    await assert.rejects(
      () => executeP4WorkerGate({
        definition: {
          gate: 'first-run',
          label: 'Gate 0',
          journeyId: 'fixture-ready-hang',
          manifestBudgetMs: 750,
          effectiveBudgetMs: 750,
          budgetSource: 'manifest',
        },
        repoRoot: import.meta.dirname,
        outputDir,
        prerequisite: null,
        productRoot,
        workerPath,
      }),
      (error) => {
        assert.equal(error.code, 'P4_GATE_DEADLINE_EXCEEDED');
        assert.equal(error.telemetry.deadline.exceeded, true);
        assert.equal(error.telemetry.termination.outcome, 'terminated');
        return true;
      },
    );
    assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, 'ready.json'), 'utf8')).ready, true);
    const descendantPid = Number(fs.readFileSync(path.join(outputDir, 'descendant.pid'), 'utf8').trim());
    assert.equal(await waitForProcessExit(descendantPid), true, `descendant ${descendantPid} survived worker teardown`);
    assert.equal(fs.readFileSync(durableSentinel, 'utf8'), 'preserve-me\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('termination helper fails closed when child close never settles', async () => {
  const never = new Promise(() => {});
  const started = Date.now();
  await assert.rejects(
    () => terminateProcessTree({
      child: { pid: 424242, exitCode: null, signalCode: null, kill() {} },
      completed: never,
    }, {
      platform: 'linux',
      termGraceMs: 20,
      closeTimeoutMs: 40,
      signalGroup() {},
    }),
    (error) => error?.code === 'P4_GATE_TERMINATION_FAILED',
  );
  assert.ok(Date.now() - started < 500, 'termination helper exceeded its bounded test deadline');
});

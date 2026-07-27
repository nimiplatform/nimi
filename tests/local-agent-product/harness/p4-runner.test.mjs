import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { terminateProcessTree } from './cross-app-driver.mjs';
import { executeP4WorkerGate } from './p4-worker-supervisor.mjs';

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

test('P4 supervisor enforces a 750ms deadline, kills the worker tree, and preserves durable state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-p4-supervisor-test-'));
  const outputDir = path.join(root, 'evidence');
  const durableStateRoot = path.join(root, 'durable-state');
  fs.mkdirSync(durableStateRoot);
  const durableSentinel = path.join(durableStateRoot, 'durable-sentinel.txt');
  fs.writeFileSync(durableSentinel, 'preserve-me\n', 'utf8');
  const workerPath = path.join(import.meta.dirname, 'fixtures', 'p4-ready-hang-worker.mjs');
  try {
    await assert.rejects(
      () => executeP4WorkerGate({
        definition: {
          gate: 'first-run',
          label: 'Gate 0',
          journeyId: 'fixture-ready-hang',
          defaultBudgetMs: 750,
          effectiveBudgetMs: 750,
          budgetSource: 'runner',
        },
        repoRoot: import.meta.dirname,
        outputDir,
        prerequisite: null,
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

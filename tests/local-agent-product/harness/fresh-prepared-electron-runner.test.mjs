import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  TERMINAL_SCHEMA,
  createTerminalEvidenceWriter,
  findBlockingElectronCarriers,
  projectOwnedProcessOutcome,
  recoverAbandonedTerminalEvidence,
  runBoundedOwnedProcess,
  writeOwnedProcessTerminal,
} from './fresh-prepared-electron-runner.mjs';

const repo = 'D:\\nimi-realm\\nimi';

test('fresh-prepared process checkpoint identifies stale Desktop and Zhiyu carriers', () => {
  const rows = [
    { ProcessId: 10, Name: 'Nimi Desktop Runtime.exe', ExecutablePath: `${repo}\\.nimi\\local\\electron-desktop-runtime\\42.5.0\\Nimi Desktop Runtime.exe` },
    { ProcessId: 11, Name: 'electron.exe', ExecutablePath: `${repo}\\apps\\zhiyu\\node_modules\\electron\\dist\\electron.exe` },
  ];
  assert.deepEqual(findBlockingElectronCarriers(rows, repo).map((row) => row.processId), [10, 11]);
});

test('fresh-prepared process checkpoint identifies an orphaned exact Zhiyu Vite 1472 renderer', () => {
  const rows = [{
    ProcessId: 12,
    Name: 'node.exe',
    ExecutablePath: 'C:\\Program Files\\nodejs\\node.exe',
    CommandLine: `node ${repo}\\apps\\zhiyu\\node_modules\\vite\\bin\\vite.js --host 127.0.0.1 --port 1472 --strictPort`,
  }];
  assert.equal(findBlockingElectronCarriers(rows, repo).length, 1);
});

test('fresh-prepared process checkpoint leaves unrelated Electron, Vite, and port text alone', () => {
  const rows = [
    { ProcessId: 20, Name: 'electron.exe', ExecutablePath: 'C:\\Program Files\\Unrelated\\electron.exe' },
    { ProcessId: 21, Name: 'node.exe', CommandLine: `node ${repo}\\apps\\web\\node_modules\\vite\\bin\\vite.js --port 1472` },
    { ProcessId: 22, Name: 'node.exe', CommandLine: `node ${repo}\\apps\\zhiyu\\note.js --message vite --port 14720` },
  ];
  assert.deepEqual(findBlockingElectronCarriers(rows, repo), []);
});

test('fresh-prepared preflight reconciles a dead parent without rewriting a live run', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-fresh-prepared-recovery-'));
  try {
    const deadRoot = path.join(root, 'dead');
    const dead = createTerminalEvidenceWriter({
      evidenceRoot: deadRoot,
      target: 'first-run',
      sourceDigest: 'a'.repeat(64),
    });
    dead.phase('journey', { parentProcessId: 9001, child: { pid: 9002, owner: 'fixture' } });
    const liveRoot = path.join(root, 'live');
    const live = createTerminalEvidenceWriter({
      evidenceRoot: liveRoot,
      target: 'owner-minimal',
      sourceDigest: 'b'.repeat(64),
    });
    live.phase('journey', { parentProcessId: 9010, child: { pid: 9011, owner: 'fixture' } });
    const recovered = recoverAbandonedTerminalEvidence(root, {
      isProcessAlive: (pid) => pid === 9010,
      recoveredAt: '2026-07-16T06:00:00.000Z',
    });
    assert.deepEqual(recovered, [dead.evidencePath]);
    assert.equal(JSON.parse(fs.readFileSync(dead.evidencePath, 'utf8')).outcome, 'abandoned-parent');
    assert.equal(JSON.parse(fs.readFileSync(live.evidencePath, 'utf8')).terminal, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fresh-prepared bounded child records a normal exit and terminal evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-fresh-prepared-normal-'));
  try {
    const outcome = await runBoundedOwnedProcess(process.execPath, ['-e', 'process.exit(0)'], {
      cwd: root,
      env: process.env,
      timeoutMs: 5_000,
    });
    assert.equal(outcome.kind, 'completed');
    assert.equal(outcome.result.code, 0);
    assertTerminalOutcome(root, outcome, 'completed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fresh-prepared bounded child terminates only its owned process and persists timeout evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-fresh-prepared-timeout-'));
  try {
    const outcome = await runBoundedOwnedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: root,
      env: process.env,
      timeoutMs: 100,
    });
    assert.equal(outcome.kind, 'timeout');
    assertTerminalOutcome(root, outcome, 'timed-out');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fresh-prepared bounded child persists abnormal nonzero and spawn failure evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-fresh-prepared-abnormal-'));
  try {
    const nonzero = await runBoundedOwnedProcess(process.execPath, ['-e', 'process.exit(7)'], {
      cwd: root,
      env: process.env,
      timeoutMs: 5_000,
    });
    assert.deepEqual(projectOwnedProcessOutcome(nonzero), {
      outcome: 'failed',
      exit: { code: 7, signal: null },
    });
    assertTerminalOutcome(path.join(root, 'nonzero'), nonzero, 'failed');

    const missing = await runBoundedOwnedProcess(path.join(root, 'missing-executable'), [], {
      cwd: root,
      env: process.env,
      timeoutMs: 5_000,
    });
    assert.equal(missing.kind, 'spawn-error');
    assertTerminalOutcome(path.join(root, 'spawn'), missing, 'spawn-failed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fresh-prepared bounded child persists parent-signal evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-fresh-prepared-signal-'));
  let signalResolve;
  const signalLatch = {
    wait: () => new Promise((resolve) => { signalResolve = resolve; }),
  };
  try {
    const running = runBoundedOwnedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: root,
      env: process.env,
      timeoutMs: 5_000,
      signalLatch,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    signalResolve('SIGTERM');
    const outcome = await running;
    assert.equal(outcome.kind, 'parent-signal');
    assertTerminalOutcome(root, outcome, 'parent-signal');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fresh-prepared bounded child cleans up and persists runner callback exceptions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-fresh-prepared-callback-'));
  try {
    const outcome = await runBoundedOwnedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: root,
      env: process.env,
      timeoutMs: 5_000,
      onStarted: () => { throw new Error('fixture callback failed'); },
    });
    assert.equal(outcome.kind, 'owner-callback-error');
    assertTerminalOutcome(root, outcome, 'runner-failed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function assertTerminalOutcome(root, outcome, expectedOutcome) {
  const writer = createTerminalEvidenceWriter({
    evidenceRoot: root,
    target: 'owner-minimal',
    sourceDigest: 'a'.repeat(64),
    preparationId: 'b'.repeat(32),
  });
  writeOwnedProcessTerminal(writer, outcome);
  const evidence = JSON.parse(fs.readFileSync(writer.evidencePath, 'utf8'));
  assert.equal(evidence.schemaVersion, TERMINAL_SCHEMA);
  assert.equal(evidence.terminal, true);
  assert.equal(evidence.outcome, expectedOutcome);
  assert.deepEqual(evidence.exit, projectOwnedProcessOutcome(outcome).exit);
}
